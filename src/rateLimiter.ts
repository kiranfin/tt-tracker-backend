import { readNumberEnv } from "./config.js";

const HOUR_MS = 60 * 60 * 1000;
const MAX_QUEUE_LENGTH = 200;
const BREAKER_BASE_BACKOFF_MS = 60 * 1000;
const BREAKER_MAX_BACKOFF_MS = 10 * 60 * 1000;

export type LocalRateLimitReason = "hourly_cap" | "queue_full" | "breaker_open";

export class LocalRateLimitError extends Error {
    retryAfterMs: number;
    reason: LocalRateLimitReason;

    constructor(retryAfterMs: number, reason: LocalRateLimitReason = "hourly_cap") {
        super(
            reason === "breaker_open"
                ? "myTischtennis is temporarily paused"
                : "Local upstream request limit reached"
        );
        this.name = "LocalRateLimitError";
        this.retryAfterMs = retryAfterMs;
        this.reason = reason;
    }
}

function getMaxConcurrent() {
    return Math.floor(readNumberEnv("MYTT_MAX_CONCURRENT", 4, { min: 1 }));
}

function getMinIntervalMs() {
    return readNumberEnv("MYTT_MIN_INTERVAL_MS", 150, { min: 0 });
}

// 0 schaltet die Notbremse ab.
function getMaxRequestsPerHour() {
    return readNumberEnv("MYTT_MAX_REQUESTS_PER_HOUR", 1000, { min: 0 });
}

function getQueueTimeoutMs() {
    return readNumberEnv("MYTT_QUEUE_TIMEOUT_MS", 20 * 1000, { min: 1 });
}

function getBreaker5xxThreshold() {
    return Math.floor(readNumberEnv("MYTT_BREAKER_5XX_THRESHOLD", 3, { min: 1 }));
}

// ---------------------------------------------------------------------------
// Notbremse: Stundenfenster
// ---------------------------------------------------------------------------

const requestTimestamps: number[] = [];

function cleanupOldRequests() {
    const oneHourAgo = Date.now() - HOUR_MS;

    while (requestTimestamps.length > 0 && requestTimestamps[0] < oneHourAgo) {
        requestTimestamps.shift();
    }
}

// ---------------------------------------------------------------------------
// Circuit Breaker
// ---------------------------------------------------------------------------

const breaker = {
    openUntil: 0,
    backoffMs: 0,
    consecutiveServerErrors: 0,
    lastReason: null as string | null,
    lastOpenedAt: 0,
    timesOpened: 0
};

function openBreaker(reason: string, retryAfterMs?: number) {
    const nextBackoff =
        breaker.backoffMs > 0
            ? Math.min(breaker.backoffMs * 2, BREAKER_MAX_BACKOFF_MS)
            : BREAKER_BASE_BACKOFF_MS;

    const pauseMs =
        retryAfterMs !== undefined && retryAfterMs > 0
            ? Math.min(retryAfterMs, BREAKER_MAX_BACKOFF_MS)
            : nextBackoff;

    breaker.backoffMs = retryAfterMs !== undefined && retryAfterMs > 0 ? 0 : nextBackoff;
    breaker.openUntil = Date.now() + pauseMs;
    breaker.lastReason = reason;
    breaker.lastOpenedAt = Date.now();
    breaker.timesOpened += 1;
    breaker.consecutiveServerErrors = 0;

    console.warn(
        `myTischtennis circuit breaker opened (${reason}) for ${Math.round(pauseMs / 1000)}s`
    );
}

function breakerRemainingMs() {
    return Math.max(0, breaker.openUntil - Date.now());
}

function parseRetryAfterMs(header: string | null | undefined): number | undefined {
    if (!header) {
        return undefined;
    }

    const seconds = Number(header);

    if (Number.isFinite(seconds) && seconds >= 0) {
        return seconds * 1000;
    }

    const date = Date.parse(header);

    if (Number.isFinite(date)) {
        return Math.max(0, date - Date.now());
    }

    return undefined;
}

/**
 * Meldet das Ergebnis eines Upstream Calls an den Breaker.
 * 429 oder mehrere 5xx / Netzwerkfehler am Stück pausieren die Quelle.
 */
export function reportUpstreamResult(result: {
    status?: number;
    retryAfterHeader?: string | null;
    networkError?: boolean;
}) {
    if (result.status === 429) {
        openBreaker("upstream_429", parseRetryAfterMs(result.retryAfterHeader));
        return;
    }

    if (result.networkError || (result.status !== undefined && result.status >= 500)) {
        breaker.consecutiveServerErrors += 1;

        if (breaker.consecutiveServerErrors >= getBreaker5xxThreshold()) {
            openBreaker(
                result.networkError ? "upstream_unreachable" : "upstream_5xx"
            );
        }

        return;
    }

    breaker.consecutiveServerErrors = 0;

    if (result.status !== undefined && result.status < 400) {
        breaker.backoffMs = 0;
    }
}

// ---------------------------------------------------------------------------
// Throttle: begrenzte Gleichzeitigkeit und Mindestabstand
// ---------------------------------------------------------------------------

type Waiter = {
    resolve: (release: () => void) => void;
    reject: (error: unknown) => void;
    timer: NodeJS.Timeout;
};

const queue: Waiter[] = [];
let active = 0;
let lastStartedAt = 0;
let pumpTimer: NodeJS.Timeout | null = null;

function createRelease() {
    let released = false;

    return () => {
        if (released) {
            return;
        }

        released = true;
        active -= 1;
        pump();
    };
}

function pump() {
    while (queue.length > 0 && active < getMaxConcurrent()) {
        const waitMs = lastStartedAt + getMinIntervalMs() - Date.now();

        if (waitMs > 0) {
            if (!pumpTimer) {
                pumpTimer = setTimeout(() => {
                    pumpTimer = null;
                    pump();
                }, waitMs);
            }

            return;
        }

        const waiter = queue.shift();

        if (!waiter) {
            return;
        }

        clearTimeout(waiter.timer);

        const remainingMs = breakerRemainingMs();

        if (remainingMs > 0) {
            waiter.reject(new LocalRateLimitError(remainingMs, "breaker_open"));
            continue;
        }

        active += 1;
        lastStartedAt = Date.now();
        waiter.resolve(createRelease());
    }
}

function enqueue(): Promise<() => void> {
    return new Promise((resolve, reject) => {
        if (queue.length >= MAX_QUEUE_LENGTH) {
            reject(new LocalRateLimitError(5000, "queue_full"));
            return;
        }

        const waiter: Waiter = {
            resolve,
            reject,
            timer: setTimeout(() => {
                const index = queue.indexOf(waiter);

                if (index >= 0) {
                    queue.splice(index, 1);
                }

                reject(new LocalRateLimitError(5000, "queue_full"));
            }, getQueueTimeoutMs())
        };

        queue.push(waiter);
        pump();
    });
}

/**
 * Wartet auf einen freien Upstream Slot. Der zurückgegebene release() muss
 * nach dem Request aufgerufen werden. Abgelehnt wird nur, wenn der Breaker offen ist,
 * die Notbremse (Stundenlimit) greift oder die Warteschlange voll ist.
 *
 * counted=false (z.B. /api/ttr/*) umgeht Notbremse, Breaker Sperre und Warteschlange.
 */
export async function acquireUpstreamSlot(options?: {
    counted?: boolean;
}): Promise<() => void> {
    if (options?.counted === false) {
        return () => {};
    }

    const breakerMs = breakerRemainingMs();

    if (breakerMs > 0) {
        throw new LocalRateLimitError(breakerMs, "breaker_open");
    }

    cleanupOldRequests();

    const maxPerHour = getMaxRequestsPerHour();

    if (maxPerHour > 0 && requestTimestamps.length >= maxPerHour) {
        throw new LocalRateLimitError(
            Math.max(1000, requestTimestamps[0] + HOUR_MS - Date.now()),
            "hourly_cap"
        );
    }

    const release = await enqueue();

    requestTimestamps.push(Date.now());

    return release;
}

export function getRateLimitStatus() {
    cleanupOldRequests();

    const max = getMaxRequestsPerHour();
    const used = requestTimestamps.length;
    const unlimited = max === 0;

    const resetInMs =
        requestTimestamps.length > 0
            ? Math.max(0, requestTimestamps[0] + HOUR_MS - Date.now())
            : 0;

    const breakerMs = breakerRemainingMs();

    return {
        max,
        used,
        remaining: unlimited ? null : Math.max(0, max - used),
        resetInMs,
        resetInSeconds: Math.ceil(resetInMs / 1000),
        resetAt:
            resetInMs > 0 ? new Date(Date.now() + resetInMs).toISOString() : null,
        queue: {
            active,
            waiting: queue.length,
            maxConcurrent: getMaxConcurrent(),
            minIntervalMs: getMinIntervalMs()
        },
        breaker: {
            state: breakerMs > 0 ? "open" : "closed",
            retryAfterSeconds: Math.ceil(breakerMs / 1000),
            openUntil: breakerMs > 0 ? new Date(breaker.openUntil).toISOString() : null,
            reason: breaker.lastReason,
            lastOpenedAt:
                breaker.lastOpenedAt > 0
                    ? new Date(breaker.lastOpenedAt).toISOString()
                    : null,
            timesOpened: breaker.timesOpened,
            consecutiveServerErrors: breaker.consecutiveServerErrors,
            nextBackoffSeconds: Math.round(
                Math.min(
                    breaker.backoffMs > 0
                        ? breaker.backoffMs * 2
                        : BREAKER_BASE_BACKOFF_MS,
                    BREAKER_MAX_BACKOFF_MS
                ) / 1000
            )
        }
    };
}
