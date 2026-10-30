import { getCacheEntries } from "../cache/index.js";
import { kindOfKey } from "../cacheKeys.js";
import { DATA_POLICIES } from "../policies.js";
import { getUpstreamUsage } from "../upstream/tracker.js";
import { getRateLimitStatus } from "../upstream/rateLimiter.js";

type KindStatus = {
    entries: number;
    fresh: number;
    // Abgelaufen, aber noch brauchbar: wird beim nächsten Zugriff sofort geliefert und im Hintergrund erneuert.
    stale: number;
    newestAgeSeconds: number | null;
    oldestAgeSeconds: number | null;
    // Wann der nächste frische Eintrag abläuft, also frühestens neu geladen wird.
    nextRefreshAt: string | null;
    requestsLast30Min: { interactive: number; background: number };
};

/**
 * Pro Datenart: wie viele Einträge im Cache liegen, wie alt sie sind, wann der nächste abläuft und wie
 * viele Upstream Requests sie in den letzten 30 Minuten (dem Budget Fenster) gekostet hat.
 */
export function getDataStatus(now = Date.now()) {
    const usage = getUpstreamUsage().byKindLast30Min;
    const kinds: Record<string, KindStatus> = {};

    for (const kind of Object.keys(DATA_POLICIES)) {
        kinds[kind] = {
            entries: 0,
            fresh: 0,
            stale: 0,
            newestAgeSeconds: null,
            oldestAgeSeconds: null,
            nextRefreshAt: null,
            requestsLast30Min: usage[kind] ?? { interactive: 0, background: 0 }
        };
    }

    const nextExpiry: Record<string, number> = {};

    for (const entry of getCacheEntries()) {
        const kind = kindOfKey(entry.key);
        const status = kind ? kinds[kind] : undefined;

        if (!kind || !status) {
            continue;
        }

        const ageSeconds = Math.max(0, Math.round((now - entry.fetchedAt) / 1000));

        status.entries += 1;
        status.newestAgeSeconds = Math.min(status.newestAgeSeconds ?? ageSeconds, ageSeconds);
        status.oldestAgeSeconds = Math.max(status.oldestAgeSeconds ?? ageSeconds, ageSeconds);

        if (now <= entry.expiresAt) {
            status.fresh += 1;
            nextExpiry[kind] = Math.min(nextExpiry[kind] ?? entry.expiresAt, entry.expiresAt);
        } else {
            status.stale += 1;
        }
    }

    for (const [kind, expiresAt] of Object.entries(nextExpiry)) {
        kinds[kind]!.nextRefreshAt = new Date(expiresAt).toISOString();
    }

    const rateLimit = getRateLimitStatus();

    return {
        // Verbrauchtes Budget im rollenden Fenster, Hintergrund und Nutzer getrennt.
        budget: {
            windowMinutes: rateLimit.windowMinutes,
            max: rateLimit.max,
            used: rateLimit.used,
            usedBackground: rateLimit.usedBackground,
            backgroundMax: rateLimit.backgroundMax,
            remaining: rateLimit.remaining,
            resetAt: rateLimit.resetAt
        },
        kinds,
        other: usage.other ?? { interactive: 0, background: 0 }
    };
}
