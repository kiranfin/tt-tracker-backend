import { LocalRateLimitError } from "./errors.js";

export type Release = () => void;

export type ThrottleOptions = {
    maxConcurrent: number;
    minIntervalMs: number;
    queueTimeoutMs: number;
    maxQueueLength: number;
    // Wird direkt vor dem Start geprüft und darf werfen, um den Wartenden abzulehnen.
    guard?: () => void;
};

type Waiter = {
    resolve: (release: Release) => void;
    reject: (error: unknown) => void;
    timeout: NodeJS.Timeout;
};

const QUEUE_RETRY_AFTER_MS = 5000;

/**
 * Begrenzt Gleichzeitigkeit und Abstand der Requests. Wer zu früh kommt, wartet in der
 * Reihenfolge des Eintreffens, statt abgelehnt zu werden.
 */
export class Throttle {
    private readonly queue: Waiter[] = [];
    private active = 0;
    private lastStartedAt = 0;
    private wakeTimer: NodeJS.Timeout | null = null;

    constructor(private readonly options: ThrottleOptions) {}

    acquire(): Promise<Release> {
        return new Promise((resolve, reject) => {
            if (this.queue.length >= this.options.maxQueueLength) {
                reject(new LocalRateLimitError(QUEUE_RETRY_AFTER_MS, "queue_full"));
                return;
            }

            const waiter: Waiter = {
                resolve,
                reject,
                timeout: setTimeout(() => {
                    this.queue.splice(this.queue.indexOf(waiter), 1);
                    reject(new LocalRateLimitError(QUEUE_RETRY_AFTER_MS, "queue_full"));
                }, this.options.queueTimeoutMs)
            };

            this.queue.push(waiter);
            this.dispatch();
        });
    }

    status() {
        return {
            active: this.active,
            waiting: this.queue.length,
            maxConcurrent: this.options.maxConcurrent,
            minIntervalMs: this.options.minIntervalMs
        };
    }

    private dispatch() {
        while (this.queue.length > 0 && this.active < this.options.maxConcurrent) {
            const waitMs = this.lastStartedAt + this.options.minIntervalMs - Date.now();

            if (waitMs > 0) {
                this.wakeAfter(waitMs);
                return;
            }

            const waiter = this.queue.shift();

            if (!waiter) {
                return;
            }

            clearTimeout(waiter.timeout);

            try {
                this.options.guard?.();
            } catch (error) {
                waiter.reject(error);
                continue;
            }

            this.active += 1;
            this.lastStartedAt = Date.now();
            waiter.resolve(this.createRelease());
        }
    }

    private wakeAfter(delayMs: number) {
        if (this.wakeTimer) {
            return;
        }

        this.wakeTimer = setTimeout(() => {
            this.wakeTimer = null;
            this.dispatch();
        }, delayMs);
    }

    private createRelease(): Release {
        let released = false;

        return () => {
            if (released) {
                return;
            }

            released = true;
            this.active -= 1;
            this.dispatch();
        };
    }
}
