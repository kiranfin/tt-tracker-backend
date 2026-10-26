import { config } from "../config.js";
import { CircuitBreaker, type UpstreamResult } from "./circuitBreaker.js";
import { LocalRateLimitError } from "./errors.js";
import { RequestWindow } from "./requestWindow.js";
import { Throttle, type Release } from "./throttle.js";

/**
 * myTischtennis hat zwei getrennt ausfallende Teile: die JSON API unter /api/* (Suche, TTR,
 * Live Begegnungen, hängt an deren Datenbank) und die Webseite samt `?_data` Loadern (click-TT
 * Spielpläne, Tabellen). Hängt die API, sollen die Seiten weiter erreichbar bleiben.
 */
export type UpstreamLane = "api" | "site";

export function getUpstreamLane(path: string): UpstreamLane {
    return path.startsWith("/api/") ? "api" : "site";
}

function createBreaker(lane: UpstreamLane) {
    return new CircuitBreaker({
        ...config.breaker,
        onOpen: (reason, pauseMs) => {
            console.warn(
                `myTischtennis circuit breaker (${lane}) opened (${reason}) for ${Math.round(pauseMs / 1000)}s`
            );
        }
    });
}

const breakers: Record<UpstreamLane, CircuitBreaker> = {
    api: createBreaker("api"),
    site: createBreaker("site")
};

const requestWindow = new RequestWindow(config.maxRequestsPerHour);

const throttle = new Throttle(config.throttle);

type QuotaState = {
    limit: number | null;
    remaining: number;
    resetAt: number;
};

let lastQuota: QuotaState | null = null;

/**
 * Liest den `ratelimit` Header von myTischtennis, z.B. `"360-in-30min"; r=338; t=1504`
 * (r = verbleibende Requests, t = Sekunden bis zum Reset des Fensters).
 */
export function parseRateLimitHeader(
    header: string | null | undefined,
    now = Date.now()
): QuotaState | null {
    if (!header) {
        return null;
    }

    const remaining = /(?:^|;)\s*r=(\d+)/.exec(header);
    const reset = /(?:^|;)\s*t=(\d+)/.exec(header);

    if (!remaining || !reset) {
        return null;
    }

    const limit = /"(\d+)-in-/.exec(header);

    return {
        limit: limit ? Number(limit[1]) : null,
        remaining: Number(remaining[1]),
        resetAt: now + Number(reset[1]) * 1000
    };
}

function assertBreakerClosed(lane: UpstreamLane) {
    const breaker = breakers[lane];
    const remainingMs = breaker.remainingMs();

    if (remainingMs > 0) {
        throw new LocalRateLimitError(
            remainingMs,
            breaker.isRateLimited() ? "breaker_open" : "upstream_unavailable"
        );
    }
}

/**
 * Wartet auf einen freien Upstream Slot und liefert die release Funktion, die nach dem Request
 * aufgerufen werden muss. Abgelehnt wird, wenn der Breaker der Lane offen ist, die Notbremse
 * greift oder die Warteschlange voll ist.
 *
 * counted=false (z.B. /api/ttr/*) umgeht Warteschlange und Notbremse, aber nicht den Breaker:
 * hängt myTischtennis, kommt so sofort der Cache statt 15 Sekunden Warten.
 */
export async function acquireUpstreamSlot(options: {
    lane: UpstreamLane;
    counted?: boolean;
}): Promise<Release> {
    assertBreakerClosed(options.lane);

    if (options.counted === false) {
        return () => {};
    }

    requestWindow.assertAvailable();

    const release = await throttle.acquire();

    // Während des Wartens kann der Breaker aufgegangen sein.
    try {
        assertBreakerClosed(options.lane);
    } catch (error) {
        release();
        throw error;
    }

    requestWindow.record();

    return release;
}

/** Meldet das Ergebnis eines Upstream Calls an den Breaker (auch für nicht gezählte Calls). */
export function reportUpstreamResult(
    result: UpstreamResult & { lane: UpstreamLane; rateLimitHeader?: string | null }
) {
    // Ein 429 gilt für die ganze Seite, nicht nur für die API oder die Webseite.
    if (result.status === 429) {
        for (const breaker of Object.values(breakers)) {
            breaker.report(result);
        }

        return;
    }

    breakers[result.lane].report(result);

    const quota = parseRateLimitHeader(result.rateLimitHeader);

    if (!quota) {
        return;
    }

    lastQuota = quota;

    // Rechtzeitig vor dem 429 bis zum Ende des Fensters pausieren.
    if (quota.remaining <= config.quotaReserve) {
        for (const breaker of Object.values(breakers)) {
            breaker.pauseFor("upstream_quota", quota.resetAt - Date.now());
        }
    }
}

export function getRateLimitStatus() {
    return {
        ...requestWindow.status(),
        queue: throttle.status(),
        breaker: {
            api: breakers.api.status(),
            site: breakers.site.status()
        },
        upstreamQuota: lastQuota
            ? {
                  limit: lastQuota.limit,
                  remaining: lastQuota.remaining,
                  reserve: config.quotaReserve,
                  resetAt: new Date(lastQuota.resetAt).toISOString()
              }
            : null
    };
}
