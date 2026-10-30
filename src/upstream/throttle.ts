import { LocalRateLimitError } from "./errors.js";
import type { UpstreamPriority } from "./priority.js";

export type Release = () => void;

export type ThrottleOptions = {
    maxConcurrent: number;
    minIntervalMs: number;
    // Obergrenze für das Tempo, wenn myTischtennis bremst (siehe slowDown).
    maxIntervalMs?: number;
    queueTimeoutMs: number;
    maxQueueLength: number;
    // Hintergrundarbeit darf länger warten und hat eine eigene Warteschlange. Standard wie interaktiv.
    backgroundQueueTimeoutMs?: number;
    maxBackgroundQueueLength?: number;
    // Wird direkt vor dem Start geprüft und darf werfen, um den Wartenden abzulehnen.
    guard?: () => void;
};

export type PaceChange = { from: number; to: number };

type Waiter = {
    resolve: (release: Release) => void;
    reject: (error: unknown) => void;
    timeout: NodeJS.Timeout;
};

const QUEUE_RETRY_AFTER_MS = 5000;
const DEFAULT_MAX_INTERVAL_MS = 3000;
// So viele Erfolge in Folge, bevor das Intervall wieder schrumpft.
const SUCCESSES_BEFORE_SPEEDUP = 25;
const SPEEDUP_FACTOR = 0.8;

/**
 * Begrenzt Gleichzeitigkeit und Abstand der Requests. Wer zu früh kommt, wartet in der
 * Reihenfolge des Eintreffens, statt abgelehnt zu werden.
 *
 * Interaktive Anfragen (ein Nutzer wartet) kommen vor Hintergrundarbeit dran. Hintergrundarbeit belegt
 * höchstens `maxConcurrent - 1` Plätze, damit ein Nutzer immer sofort einen freien Platz findet.
 *
 * Das Intervall startet bei `minIntervalMs`, wird bei einem 429 verdoppelt (`slowDown`) und nach einer
 * Serie von Erfolgen (`recordSuccess`) wieder kleiner, aber nie unter `minIntervalMs`.
 */
export class Throttle {
    private readonly queues: Record<UpstreamPriority, Waiter[]> = {
        interactive: [],
        background: []
    };
    private active = 0;
    private activeBackground = 0;
    private lastStartedAt = 0;
    private wakeTimer: NodeJS.Timeout | null = null;
    private currentIntervalMs: number;
    private successStreak = 0;

    constructor(private readonly options: ThrottleOptions) {
        this.currentIntervalMs = options.minIntervalMs;
    }

    acquire(priority: UpstreamPriority = "interactive"): Promise<Release> {
        return new Promise((resolve, reject) => {
            const queue = this.queues[priority];
            const maxLength =
                priority === "background"
                    ? (this.options.maxBackgroundQueueLength ?? this.options.maxQueueLength)
                    : this.options.maxQueueLength;
            const timeoutMs =
                priority === "background"
                    ? (this.options.backgroundQueueTimeoutMs ?? this.options.queueTimeoutMs)
                    : this.options.queueTimeoutMs;

            if (queue.length >= maxLength) {
                reject(new LocalRateLimitError(QUEUE_RETRY_AFTER_MS, "queue_full"));
                return;
            }

            const waiter: Waiter = {
                resolve,
                reject,
                timeout: setTimeout(() => {
                    queue.splice(queue.indexOf(waiter), 1);
                    reject(new LocalRateLimitError(QUEUE_RETRY_AFTER_MS, "queue_full"));
                }, timeoutMs)
            };

            queue.push(waiter);
            this.dispatch();
        });
    }

    /** myTischtennis hat mit 429 geantwortet: Intervall verdoppeln, höchstens bis `maxIntervalMs`. */
    slowDown(): PaceChange | null {
        this.successStreak = 0;

        const max = Math.max(
            this.options.minIntervalMs,
            this.options.maxIntervalMs ?? DEFAULT_MAX_INTERVAL_MS
        );
        const next = Math.min(max, Math.max(this.currentIntervalMs, 1) * 2);

        return this.setInterval(next);
    }

    /** Nach genug Erfolgen in Folge das Intervall um 20 Prozent senken, nie unter `minIntervalMs`. */
    recordSuccess(): PaceChange | null {
        if (this.currentIntervalMs <= this.options.minIntervalMs) {
            this.successStreak = 0;
            return null;
        }

        this.successStreak += 1;

        if (this.successStreak < SUCCESSES_BEFORE_SPEEDUP) {
            return null;
        }

        this.successStreak = 0;

        return this.setInterval(
            Math.max(this.options.minIntervalMs, Math.round(this.currentIntervalMs * SPEEDUP_FACTOR))
        );
    }

    status() {
        return {
            active: this.active,
            activeBackground: this.activeBackground,
            waiting: this.queues.interactive.length + this.queues.background.length,
            waitingInteractive: this.queues.interactive.length,
            waitingBackground: this.queues.background.length,
            maxConcurrent: this.options.maxConcurrent,
            minIntervalMs: this.options.minIntervalMs,
            currentIntervalMs: this.currentIntervalMs
        };
    }

    private setInterval(next: number): PaceChange | null {
        if (next === this.currentIntervalMs) {
            return null;
        }

        const change = { from: this.currentIntervalMs, to: next };

        this.currentIntervalMs = next;

        return change;
    }

    /** Wer als Nächstes dran ist: Nutzer zuerst, Hintergrund nur mit Platz in seinem Anteil. */
    private nextPriority(): UpstreamPriority | null {
        if (this.queues.interactive.length > 0) {
            return "interactive";
        }

        const backgroundLimit = Math.max(1, this.options.maxConcurrent - 1);

        if (this.queues.background.length > 0 && this.activeBackground < backgroundLimit) {
            return "background";
        }

        return null;
    }

    private dispatch() {
        while (this.active < this.options.maxConcurrent) {
            const priority = this.nextPriority();

            if (!priority) {
                return;
            }

            const waitMs = this.lastStartedAt + this.currentIntervalMs - Date.now();

            if (waitMs > 0) {
                this.wakeAfter(waitMs);
                return;
            }

            const waiter = this.queues[priority].shift();

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

            if (priority === "background") {
                this.activeBackground += 1;
            }

            this.lastStartedAt = Date.now();
            waiter.resolve(this.createRelease(priority));
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

    private createRelease(priority: UpstreamPriority): Release {
        let released = false;

        return () => {
            if (released) {
                return;
            }

            released = true;
            this.active -= 1;

            if (priority === "background") {
                this.activeBackground -= 1;
            }

            this.dispatch();
        };
    }
}
