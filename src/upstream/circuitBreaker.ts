export type UpstreamResult = {
    status?: number;
    retryAfterHeader?: string | null;
    networkError?: boolean;
};

export type CircuitBreakerOptions = {
    baseBackoffMs: number;
    maxBackoffMs: number;
    serverErrorThreshold: number;
    now?: () => number;
    onOpen?: (reason: string, pauseMs: number) => void;
};

function parseRetryAfterMs(header: string | null | undefined, now: number) {
    if (!header) {
        return undefined;
    }

    const seconds = Number(header);

    if (Number.isFinite(seconds) && seconds >= 0) {
        return seconds * 1000;
    }

    const date = Date.parse(header);

    return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

/**
 * Pausiert myTischtennis, wenn die Seite selbst bremst: bei einem 429 oder mehreren
 * 5xx / Netzwerkfehlern in Folge. Ohne Retry-After wächst die Pause exponentiell.
 */
export class CircuitBreaker {
    private readonly now: () => number;
    private openUntil = 0;
    private backoffMs = 0;
    private consecutiveServerErrors = 0;
    private lastReason: string | null = null;
    private lastOpenedAt = 0;
    private timesOpened = 0;

    constructor(private readonly options: CircuitBreakerOptions) {
        this.now = options.now ?? Date.now;
    }

    remainingMs() {
        return Math.max(0, this.openUntil - this.now());
    }

    report(result: UpstreamResult) {
        if (result.status === 429) {
            this.open("upstream_429", parseRetryAfterMs(result.retryAfterHeader, this.now()));
            return;
        }

        const isServerError =
            result.networkError === true ||
            (result.status !== undefined && result.status >= 500);

        if (isServerError) {
            this.consecutiveServerErrors += 1;

            if (this.consecutiveServerErrors >= this.options.serverErrorThreshold) {
                this.open(result.networkError ? "upstream_unreachable" : "upstream_5xx");
            }

            return;
        }

        this.consecutiveServerErrors = 0;

        if (result.status !== undefined && result.status < 400) {
            this.backoffMs = 0;
        }
    }

    status() {
        const remainingMs = this.remainingMs();

        return {
            state: remainingMs > 0 ? "open" : "closed",
            retryAfterSeconds: Math.ceil(remainingMs / 1000),
            openUntil: remainingMs > 0 ? new Date(this.openUntil).toISOString() : null,
            reason: this.lastReason,
            lastOpenedAt:
                this.lastOpenedAt > 0 ? new Date(this.lastOpenedAt).toISOString() : null,
            timesOpened: this.timesOpened,
            consecutiveServerErrors: this.consecutiveServerErrors,
            nextBackoffSeconds: Math.round(this.nextBackoffMs() / 1000)
        };
    }

    private nextBackoffMs() {
        return this.backoffMs > 0
            ? Math.min(this.backoffMs * 2, this.options.maxBackoffMs)
            : this.options.baseBackoffMs;
    }

    private open(reason: string, retryAfterMs?: number) {
        const hasRetryAfter = retryAfterMs !== undefined && retryAfterMs > 0;
        const nextBackoffMs = this.nextBackoffMs();

        const pauseMs = hasRetryAfter
            ? Math.min(retryAfterMs, this.options.maxBackoffMs)
            : nextBackoffMs;

        this.backoffMs = hasRetryAfter ? 0 : nextBackoffMs;
        this.openUntil = this.now() + pauseMs;
        this.lastReason = reason;
        this.lastOpenedAt = this.now();
        this.timesOpened += 1;
        this.consecutiveServerErrors = 0;

        this.options.onOpen?.(reason, pauseMs);
    }
}
