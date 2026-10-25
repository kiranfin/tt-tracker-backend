import { LocalRateLimitError } from "./errors.js";

const HOUR_MS = 60 * 60 * 1000;

/** Notbremse: höchstens `maxPerHour` Requests in der letzten Stunde (0 = unbegrenzt). */
export class RequestWindow {
    private readonly timestamps: number[] = [];

    constructor(
        private readonly maxPerHour: number,
        private readonly now: () => number = Date.now
    ) {}

    assertAvailable() {
        this.prune();

        if (this.maxPerHour > 0 && this.timestamps.length >= this.maxPerHour) {
            throw new LocalRateLimitError(
                Math.max(1000, this.resetInMs()),
                "hourly_cap"
            );
        }
    }

    record() {
        this.timestamps.push(this.now());
    }

    status() {
        this.prune();

        const resetInMs = this.resetInMs();
        const used = this.timestamps.length;

        return {
            max: this.maxPerHour,
            used,
            remaining:
                this.maxPerHour === 0 ? null : Math.max(0, this.maxPerHour - used),
            resetInMs,
            resetInSeconds: Math.ceil(resetInMs / 1000),
            resetAt:
                resetInMs > 0 ? new Date(this.now() + resetInMs).toISOString() : null
        };
    }

    private resetInMs() {
        return this.timestamps.length > 0
            ? Math.max(0, this.timestamps[0] + HOUR_MS - this.now())
            : 0;
    }

    private prune() {
        const cutoff = this.now() - HOUR_MS;

        while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) {
            this.timestamps.shift();
        }
    }
}
