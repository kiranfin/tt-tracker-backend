import { writeJsonLog } from "../fileLogger.js";
import { runInBackground } from "../upstream/priority.js";
import { canRunBackgroundWork } from "../upstream/rateLimiter.js";

/**
 * Hintergrundjobs für Arbeit, auf die keine Antwort wartet (fehlende Logos, Andro Kandidatensuche).
 * Sie laufen nacheinander mit Hintergrund Priorität und damit im Budget für Hintergrundarbeit.
 * Ein Job pro Schlüssel gleichzeitig, bei Challenge oder leerem Budget wird nichts eingeplant.
 */

const MAX_PENDING_JOBS = 100;

const pending = new Set<string>();
let chain: Promise<void> = Promise.resolve();

/** Plant einen Job ein. false, wenn es ihn schon gibt, die Liste voll ist oder gerade nichts angefragt werden soll. */
export function scheduleBackground(key: string, run: () => Promise<unknown>): boolean {
    if (pending.has(key) || pending.size >= MAX_PENDING_JOBS || !canRunBackgroundWork()) {
        return false;
    }

    pending.add(key);

    chain = chain.then(async () => {
        try {
            await runInBackground(run);
        } catch (error) {
            void writeJsonLog("background_job_failed", {
                key,
                errorName: error instanceof Error ? error.name : "UnknownError",
                errorMessage: error instanceof Error ? error.message : "Unknown error"
            });
        } finally {
            pending.delete(key);
        }
    });

    return true;
}

export function getBackgroundJobStatus() {
    return { pending: pending.size, max: MAX_PENDING_JOBS };
}

/** Wartet, bis alle bisher eingeplanten Jobs durch sind (Tests). */
export function whenBackgroundIdle() {
    return chain;
}
