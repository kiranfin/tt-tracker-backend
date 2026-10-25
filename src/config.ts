import { resolve } from "node:path";

function readNumber(key: string, fallback: number, min = 0): number {
    const raw = process.env[key];

    if (!raw || raw.trim() === "") {
        return fallback;
    }

    const parsed = Number(raw);

    if (!Number.isFinite(parsed) || parsed < min) {
        console.warn(`Invalid ${key}="${raw}", falling back to ${fallback}`);
        return fallback;
    }

    return parsed;
}

function readBoolean(key: string, fallback: boolean): boolean {
    const raw = process.env[key]?.trim().toLowerCase();

    if (raw === "true" || raw === "1") {
        return true;
    }

    if (raw === "false" || raw === "0") {
        return false;
    }

    return fallback;
}

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * Alle Einstellungen für myTischtennis und Cache, einmal beim Start gelesen.
 * `dotenv/config` muss vorher geladen sein (erster Import in server.ts).
 */
export const config = {
    upstream: {
        enabled: process.env.MYTT_UPSTREAM_ENABLED !== "false",
        baseUrl: process.env.MYTT_BASE_URL ?? "https://www.mytischtennis.de",
        requestTimeoutMs: readNumber("MYTT_REQUEST_TIMEOUT_MS", 15 * SECOND_MS, 1),
        htmlFallbackEnabled: readBoolean("MYTT_HTML_FALLBACK_ENABLED", true),
        // Nur Entwicklung: lässt die JSON API absichtlich scheitern, um den HTML Fallback zu testen.
        forceApiFailure:
            process.env.NODE_ENV !== "production" &&
            readBoolean("MYTT_FORCE_API_FAILURE", false),
        html: {
            timeoutMs: readNumber("MYTT_HTML_TIMEOUT_MS", 5 * SECOND_MS, 1),
            maxBytes: readNumber("MYTT_HTML_MAX_BYTES", 1_500_000, 1),
            userAgent:
                process.env.MYTT_HTML_USER_AGENT ??
                "Mozilla/5.0 (compatible; TischtennisTracker/1.0)"
        }
    },

    throttle: {
        maxConcurrent: Math.floor(readNumber("MYTT_MAX_CONCURRENT", 4, 1)),
        minIntervalMs: readNumber("MYTT_MIN_INTERVAL_MS", 150),
        queueTimeoutMs: readNumber("MYTT_QUEUE_TIMEOUT_MS", 20 * SECOND_MS, 1),
        maxQueueLength: 200
    },

    // 0 schaltet die Notbremse ab.
    maxRequestsPerHour: readNumber("MYTT_MAX_REQUESTS_PER_HOUR", 1000),

    breaker: {
        baseBackoffMs: MINUTE_MS,
        maxBackoffMs: 10 * MINUTE_MS,
        serverErrorThreshold: Math.floor(readNumber("MYTT_BREAKER_5XX_THRESHOLD", 3, 1))
    },

    // Täglicher Abgleich API gegen Webseite auf festen alten Saison Seiten. 0 = aus (lokal).
    canary: {
        intervalHours: readNumber("CANARY_INTERVAL_HOURS", 0),
        alertEmail: process.env.TTTRACKER_ALERT_EMAIL?.trim() || undefined
    },

    cache: {
        maxEntries: Math.floor(readNumber("CACHE_MAX_ENTRIES", 2000, 1)),
        staleMaxAgeMs: readNumber("CACHE_STALE_MAX_AGE_MS", 7 * DAY_MS),
        failedLoadRetryMs: readNumber("CACHE_FAILED_LOAD_RETRY_MS", 30 * SECOND_MS),
        persist: {
            enabled: readBoolean("CACHE_PERSIST_ENABLED", true),
            file: resolve(process.env.CACHE_PERSIST_FILE ?? "data/cache.json"),
            intervalMs: 5 * MINUTE_MS
        }
    }
} as const;
