const requestTimestamps: number[] = [];

const WINDOW_MS = 60 * 60 * 1000;

export class LocalRateLimitError extends Error {
    retryAfterMs: number;

    constructor(retryAfterMs: number) {
        super("Local upstream request limit reached");
        this.name = "LocalRateLimitError";
        this.retryAfterMs = retryAfterMs;
    }
}

function getMaxRequestsPerHour(): number {
    const raw = process.env.MYTT_MAX_REQUESTS_PER_HOUR;

    if (!raw || raw.trim() === "") {
        return 60;
    }

    const parsed = Number(raw);

    if (!Number.isFinite(parsed) || parsed < 1) {
        console.warn(
            `Invalid MYTT_MAX_REQUESTS_PER_HOUR="${raw}", falling back to 60`
        );
        return 60;
    }

    return parsed;
}

function cleanupOldRequests() {
    const oneHourAgo = Date.now() - WINDOW_MS;

    while (
        requestTimestamps.length > 0 &&
        requestTimestamps[0] < oneHourAgo
        ) {
        requestTimestamps.shift();
    }
}

export function getRateLimitStatus() {
    cleanupOldRequests();

    const max = getMaxRequestsPerHour();
    const used = requestTimestamps.length;
    const remaining = Math.max(0, max - used);

    const resetInMs =
        requestTimestamps.length > 0
            ? Math.max(0, requestTimestamps[0] + WINDOW_MS - Date.now())
            : 0;

    return {
        max,
        used,
        remaining,
        resetInMs,
        resetInSeconds: Math.ceil(resetInMs / 1000),
        resetAt:
            resetInMs > 0
                ? new Date(Date.now() + resetInMs).toISOString()
                : null
    };
}

export function assertCanCallUpstream(): void {
    cleanupOldRequests();

    const maxRequestsPerHour = getMaxRequestsPerHour();
    const now = Date.now();

    if (requestTimestamps.length >= maxRequestsPerHour) {
        const oldestRequest = requestTimestamps[0];
        const retryAfterMs = Math.max(1000, oldestRequest + WINDOW_MS - now);

        throw new LocalRateLimitError(retryAfterMs);
    }

    requestTimestamps.push(now);
}