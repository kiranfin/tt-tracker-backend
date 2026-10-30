import { config } from "../config.js";
import { CircuitBreaker, type UpstreamResult } from "./circuitBreaker.js";
import { LocalRateLimitError } from "./errors.js";
import { RequestWindow } from "./requestWindow.js";
import { writeJsonLog } from "../fileLogger.js";
import type { UpstreamPriority } from "./priority.js";
import { Throttle, type PaceChange, type Release } from "./throttle.js";

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

// Challenge (/verify) gilt für die IP, nicht für eine Lane: ein gemeinsamer Breaker mit Probe Pflicht.
const challengeBreaker = new CircuitBreaker({
    ...config.challenge,
    serverErrorThreshold: 1,
    onOpen: (reason, pauseMs) => {
        console.warn(
            `myTischtennis verification challenge detected, all requests paused for ${Math.round(pauseMs / 60000)} min`
        );

        void writeJsonLog("mytt_challenge_detected", {
            reason,
            pauseMs,
            ...challengeBreaker.challengeStatus()
        });
    }
});

const requestWindow = new RequestWindow(config.budget.per30Min, {
    backgroundShare: config.budget.backgroundShare
});

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
 * Prüft die Challenge Sperre. Liefert true, wenn dieser Request die einzige Probe nach der
 * Pause ist, sonst false. Wirft, solange die Pause läuft oder eine Probe schon unterwegs ist.
 */
function admitThroughChallenge(): boolean {
    const admission = challengeBreaker.admit();

    if (!admission.allowed) {
        throw new LocalRateLimitError(admission.retryAfterMs, "upstream_challenge");
    }

    if (admission.probe) {
        void writeJsonLog("mytt_challenge_probe", challengeBreaker.challengeStatus());
    }

    return admission.probe;
}

function assertStillAdmitted(probe: boolean) {
    if (!challengeBreaker.stillAdmitted(probe)) {
        throw new LocalRateLimitError(
            Math.max(challengeBreaker.remainingMs(), 10_000),
            "upstream_challenge"
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
    priority?: UpstreamPriority;
}): Promise<Release> {
    assertBreakerClosed(options.lane);

    const probe = admitThroughChallenge();

    try {
        if (options.counted === false) {
            return () => {};
        }

        requestWindow.assertAvailable(options.priority);

        const release = await throttle.acquire(options.priority);

        // Während des Wartens kann ein Breaker aufgegangen sein.
        try {
            assertBreakerClosed(options.lane);
            assertStillAdmitted(probe);
        } catch (error) {
            release();
            throw error;
        }

        requestWindow.record(options.priority);

        return release;
    } catch (error) {
        // Die Probe wurde nie gesendet: die nächste darf es versuchen.
        if (probe) {
            challengeBreaker.releaseProbe();
        }

        throw error;
    }
}

function logPaceChange(change: PaceChange | null, reason: "rate_limited" | "recovered") {
    if (!change) {
        return;
    }

    void writeJsonLog("mytt_pace_changed", {
        reason,
        fromIntervalMs: change.from,
        toIntervalMs: change.to
    });
}

/** Meldet das Ergebnis eines Upstream Calls an den Breaker (auch für nicht gezählte Calls). */
export function reportUpstreamResult(
    result: UpstreamResult & {
        lane: UpstreamLane;
        rateLimitHeader?: string | null;
        // Weiterleitung auf /verify (Bot Schutz).
        challenge?: boolean;
    }
) {
    if (result.challenge) {
        challengeBreaker.reportChallenge();

        return;
    }

    // Antwortet myTischtennis wieder normal, ist die Probe bestanden. Ein Netzwerkfehler sagt nichts.
    if (challengeBreaker.challengeStatus().probeInFlight) {
        if (result.status !== undefined) {
            challengeBreaker.reportProbeSuccess();
        } else if (result.networkError) {
            challengeBreaker.releaseProbe();
        }
    }

    if (result.status === 429) {
        logPaceChange(throttle.slowDown(), "rate_limited");

        const quota = parseRateLimitHeader(result.rateLimitHeader);

        if (quota) {
            // Echtes Kontingent (360 pro 30 Minuten) gilt für die IP: beide Lanes bis zum Reset (t=).
            const untilResetSeconds = Math.max(1, Math.ceil((quota.resetAt - Date.now()) / 1000));

            for (const breaker of Object.values(breakers)) {
                breaker.report({ ...result, retryAfterHeader: String(untilResetSeconds) });
            }

            lastQuota = quota;
        } else {
            // Ohne ratelimit Header ist es kein Kontingent, die andere Lane läuft weiter.
            breakers[result.lane].report(result);
        }

        return;
    }

    breakers[result.lane].report(result);

    if (result.status !== undefined && result.status >= 200 && result.status < 300) {
        logPaceChange(throttle.recordSuccess(), "recovered");
    }

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

/** Nur für Tests: alle Breaker zurück auf geschlossen. */
export function resetBreakersForTests() {
    challengeBreaker.reset();

    for (const breaker of Object.values(breakers)) {
        breaker.reset();
    }
}

/**
 * Darf Hintergrundarbeit jetzt noch `requests` Upstream Requests anstoßen? Nein, wenn eine Challenge
 * läuft, ein Breaker offen ist oder das Budget für Hintergrund nicht mehr reicht.
 */
export function canRunBackgroundWork(requests = 1) {
    if (challengeBreaker.challengeStatus().active) {
        return false;
    }

    if (Object.values(breakers).some((breaker) => breaker.remainingMs() > 0)) {
        return false;
    }

    return requestWindow.remainingForBackground() >= requests;
}

export function getChallengeStatus() {
    return challengeBreaker.challengeStatus();
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
