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
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * Alle Einstellungen für myTischtennis und Cache, einmal beim Start gelesen.
 * `dotenv/config` muss vorher geladen sein (erster Import in server.ts).
 */
export const config = {
    upstream: {
        enabled: process.env.MYTT_UPSTREAM_ENABLED !== "false",
        baseUrl: process.env.MYTT_BASE_URL ?? "https://www.mytischtennis.de",
        // Hängt die Datenbank von myTischtennis, kommt nach dieser Zeit der Cache statt einer Antwort.
        requestTimeoutMs: readNumber("MYTT_REQUEST_TIMEOUT_MS", 8 * SECOND_MS, 1),
        htmlFallbackEnabled: readBoolean("MYTT_HTML_FALLBACK_ENABLED", true),
        // Nur Entwicklung: lässt die JSON API absichtlich scheitern, um den HTML Fallback zu testen.
        forceApiFailure:
            process.env.NODE_ENV !== "production" &&
            readBoolean("MYTT_FORCE_API_FAILURE", false),
        // Nur Entwicklung: tut so, als leite myTischtennis auf /verify um (ohne echten Request).
        forceChallenge:
            process.env.NODE_ENV !== "production" &&
            readBoolean("MYTT_FORCE_CHALLENGE", false),
        html: {
            timeoutMs: readNumber("MYTT_HTML_TIMEOUT_MS", 5 * SECOND_MS, 1),
            maxBytes: readNumber("MYTT_HTML_MAX_BYTES", 1_500_000, 1),
            userAgent:
                process.env.MYTT_HTML_USER_AGENT ??
                "Mozilla/5.0 (compatible; TischtennisTracker/1.0)"
        }
    },

    throttle: {
        maxConcurrent: Math.floor(readNumber("MYTT_MAX_CONCURRENT", 2, 1)),
        // 150 ms (bis zu 6 bis 7 Requests pro Sekunde) hat trotz freiem Kontingent 429 ausgelöst.
        // Gleichmäßig und langsam wirkt weniger verdächtig als kurze Bursts.
        minIntervalMs: readNumber("MYTT_MIN_INTERVAL_MS", 1000),
        // Bremst myTischtennis mit 429, wächst das Intervall bis hierhin und schrumpft danach wieder.
        maxIntervalMs: readNumber("MYTT_MAX_INTERVAL_MS", 3000),
        queueTimeoutMs: readNumber("MYTT_QUEUE_TIMEOUT_MS", 20 * SECOND_MS, 1),
        maxQueueLength: 200,
        // Hintergrundarbeit (TTR Schätzung, Canary) darf länger warten, Nutzer gehen vor.
        backgroundQueueTimeoutMs: readNumber("MYTT_BACKGROUND_QUEUE_TIMEOUT_MS", 60 * SECOND_MS, 1),
        maxBackgroundQueueLength: 200
    },

    // Eigenes Budget im rollenden 30 Minuten Fenster (myTischtennis erlaubt 360, wir nutzen höchstens ein
    // Viertel). Hintergrundarbeit (Aktualisierungen, Logos, Canary) darf nur einen Anteil davon nutzen,
    // der Rest bleibt für Cache Misses, auf die ein Nutzer wartet. 0 schaltet das Budget ab.
    budget: {
        per30Min: Math.floor(readNumber("MYTT_BUDGET_PER_30MIN", 90)),
        backgroundShare: Math.min(1, readNumber("MYTT_BACKGROUND_SHARE", 0.6))
    },

    // myTischtennis meldet sein Kontingent im `ratelimit` Header (aktuell 360 pro 30 Minuten).
    // Bleiben nur noch so viele übrig, pausieren wir bis zum Reset, statt in einen 429 zu laufen.
    quotaReserve: Math.floor(readNumber("MYTT_QUOTA_RESERVE", 10)),

    breaker: {
        baseBackoffMs: MINUTE_MS,
        maxBackoffMs: 10 * MINUTE_MS,
        serverErrorThreshold: Math.floor(readNumber("MYTT_BREAKER_5XX_THRESHOLD", 3, 1))
    },

    // myTischtennis leitet auf /verify (Captcha) um: Pause für beide Lanes, danach eine einzelne Probe.
    // Jede erneute Challenge verdoppelt die Pause bis zum Maximum.
    challenge: {
        baseBackoffMs: readNumber("MYTT_CHALLENGE_PAUSE_MS", 6 * HOUR_MS, 1),
        maxBackoffMs: readNumber("MYTT_CHALLENGE_MAX_PAUSE_MS", 24 * HOUR_MS, 1)
    },

    features: {
        // Die TTR Schätzung erzeugt viele myTT Requests (Spielberichte), vorerst aus.
        ttrEstimate: readBoolean("TTR_ESTIMATE_ENABLED", false)
    },

    // Täglicher Abgleich API gegen Webseite auf festen alten Saison Seiten. 0 = aus (lokal).
    canary: {
        intervalHours: readNumber("CANARY_INTERVAL_HOURS", 0),
        alertEmail: process.env.TTTRACKER_ALERT_EMAIL?.trim() || undefined
    },

    // Dauerhafte Ablage (SQLite) für abgeschlossene Spielberichte und eingefrorene Gegnerwerte.
    store: {
        enabled: readBoolean("STORE_ENABLED", true),
        file:
            process.env.STORE_FILE === ":memory:"
                ? ":memory:"
                : resolve(process.env.STORE_FILE ?? "data/store.db")
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
