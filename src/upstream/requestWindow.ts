import { LocalRateLimitError } from "./errors.js";
import type { UpstreamPriority } from "./priority.js";

const DEFAULT_WINDOW_MS = 30 * 60 * 1000;

type Entry = { at: number; priority: UpstreamPriority };

/**
 * Eigenes Budget: höchstens `budget` Requests im rollenden Fenster (Standard 30 Minuten, das Fenster
 * von myTischtennis). Hintergrundarbeit darf höchstens `backgroundShare` davon nutzen, der Rest bleibt
 * für Cache Misses, auf die ein Nutzer wartet. 0 schaltet das Budget ab.
 */
export class RequestWindow {
    private readonly entries: Entry[] = [];

    constructor(
        private readonly budget: number,
        private readonly options: {
            windowMs?: number;
            backgroundShare?: number;
            now?: () => number;
        } = {}
    ) {}

    private get windowMs() {
        return this.options.windowMs ?? DEFAULT_WINDOW_MS;
    }

    private get now() {
        return this.options.now ?? Date.now;
    }

    private get backgroundLimit() {
        return Math.floor(this.budget * (this.options.backgroundShare ?? 1));
    }

    assertAvailable(priority: UpstreamPriority = "interactive") {
        if (this.budget <= 0) {
            return;
        }

        this.prune();

        const total = this.entries.length;
        const background = this.entries.filter((entry) => entry.priority === "background").length;

        const exhausted =
            total >= this.budget || (priority === "background" && background >= this.backgroundLimit);

        if (exhausted) {
            // Frei wird wieder etwas, sobald der älteste Eintrag des betroffenen Anteils herausfällt.
            const relevant =
                priority === "background" && background >= this.backgroundLimit
                    ? this.entries.filter((entry) => entry.priority === "background")
                    : this.entries;

            throw new LocalRateLimitError(
                Math.max(1000, (relevant[0]?.at ?? this.now()) + this.windowMs - this.now()),
                "budget_exhausted"
            );
        }
    }

    record(priority: UpstreamPriority = "interactive") {
        this.entries.push({ at: this.now(), priority });
    }

    /** Wie viele Hintergrund Requests noch ins Budget passen (ohne den Platz für Nutzer). */
    remainingForBackground() {
        if (this.budget <= 0) {
            return Number.POSITIVE_INFINITY;
        }

        this.prune();

        const background = this.entries.filter((entry) => entry.priority === "background").length;

        return Math.max(
            0,
            Math.min(this.backgroundLimit - background, this.budget - this.entries.length)
        );
    }

    status() {
        this.prune();

        const used = this.entries.length;
        const background = this.entries.filter((entry) => entry.priority === "background").length;
        const resetInMs =
            this.entries.length > 0
                ? Math.max(0, this.entries[0]!.at + this.windowMs - this.now())
                : 0;

        return {
            windowMinutes: Math.round(this.windowMs / 60000),
            max: this.budget,
            used,
            usedBackground: background,
            backgroundMax: this.budget > 0 ? this.backgroundLimit : null,
            remaining: this.budget === 0 ? null : Math.max(0, this.budget - used),
            resetInMs,
            resetInSeconds: Math.ceil(resetInMs / 1000),
            resetAt: resetInMs > 0 ? new Date(this.now() + resetInMs).toISOString() : null
        };
    }

    private prune() {
        const cutoff = this.now() - this.windowMs;

        while (this.entries.length > 0 && this.entries[0]!.at < cutoff) {
            this.entries.shift();
        }
    }
}
