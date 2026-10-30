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

// Eine Probe, die nie ein Ergebnis meldet (z.B. abgebrochen), blockiert die nächste nicht ewig.
const PROBE_TIMEOUT_MS = 2 * 60 * 1000;
const PROBE_BUSY_RETRY_MS = 10 * 1000;

export type Admission =
    | { allowed: true; probe: boolean }
    | { allowed: false; retryAfterMs: number };

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
    // Half-open: nach der Pause darf genau ein Request als Probe durch, erst sein Ergebnis entscheidet.
    private probeRequired = false;
    private probeStartedAt = 0;
    private probes = 0;
    private requiredSince = 0;

    constructor(private readonly options: CircuitBreakerOptions) {
        this.now = options.now ?? Date.now;
    }

    /** Setzt den Zustand zurück (Tests). */
    reset() {
        this.openUntil = 0;
        this.backoffMs = 0;
        this.consecutiveServerErrors = 0;
        this.lastReason = null;
        this.lastOpenedAt = 0;
        this.timesOpened = 0;
        this.probeRequired = false;
        this.probeStartedAt = 0;
        this.probes = 0;
        this.requiredSince = 0;
    }

    remainingMs() {
        return Math.max(0, this.openUntil - this.now());
    }

    /** true, wenn myTischtennis selbst gebremst hat (429 oder Kontingent), nicht bei Ausfällen. */
    isRateLimited() {
        return this.lastReason === "upstream_429" || this.lastReason === "upstream_quota";
    }

    /**
     * Pausiert bis zum Ende des Kontingent Fensters, ohne den Backoff zu verändern.
     * Eine bereits längere Pause bleibt bestehen.
     */
    pauseFor(reason: string, pauseMs: number) {
        const until = this.now() + Math.min(pauseMs, this.options.maxBackoffMs);

        if (until <= this.openUntil) {
            return;
        }

        this.openUntil = until;
        this.lastReason = reason;
        this.lastOpenedAt = this.now();
        this.timesOpened += 1;

        this.options.onOpen?.(reason, until - this.now());
    }

    /**
     * Entscheidet, ob ein Request durch darf. Nach einer Pause mit Probe Pflicht (Challenge) lässt
     * das genau einen Request als Probe durch, alle anderen warten auf dessen Ergebnis.
     * Der Aufrufer muss danach reportProbeSuccess, reportChallenge oder releaseProbe aufrufen.
     */
    admit(): Admission {
        const remainingMs = this.remainingMs();

        if (remainingMs > 0) {
            return { allowed: false, retryAfterMs: remainingMs };
        }

        if (!this.probeRequired) {
            return { allowed: true, probe: false };
        }

        if (this.probeStartedAt > 0 && this.now() - this.probeStartedAt < PROBE_TIMEOUT_MS) {
            return { allowed: false, retryAfterMs: PROBE_BUSY_RETRY_MS };
        }

        this.probeStartedAt = this.now();
        this.probes += 1;

        return { allowed: true, probe: true };
    }

    /**
     * Für Requests, die admit() schon passiert haben und danach in der Warteschlange standen:
     * gilt die Freigabe noch? Wurde inzwischen eine Challenge gemeldet, ist sie hinfällig,
     * nur die Probe selbst darf trotz Probe Pflicht weiter.
     */
    stillAdmitted(probe: boolean) {
        if (this.remainingMs() > 0) {
            return false;
        }

        return probe || !this.probeRequired;
    }

    /**
     * Challenge: Pause mit wachsender Dauer (base, dann Verdopplung bis max) und danach nur noch
     * eine Probe. Meldungen von Requests, die schon vor der Pause unterwegs waren, zählen nicht doppelt.
     */
    reportChallenge() {
        if (this.remainingMs() > 0) {
            return;
        }

        if (!this.probeRequired) {
            this.requiredSince = this.now();
        }

        this.probeRequired = true;
        this.probeStartedAt = 0;
        this.open("upstream_challenge");
    }

    /** Die Probe kam ohne Challenge zurück: wieder geschlossen, nächster Fall beginnt von vorn. */
    reportProbeSuccess() {
        this.probeRequired = false;
        this.probeStartedAt = 0;
        this.requiredSince = 0;
        this.backoffMs = 0;
    }

    /** Die Probe wurde nicht gesendet oder blieb ohne Antwort: die nächste darf es versuchen. */
    releaseProbe() {
        this.probeStartedAt = 0;
    }

    challengeStatus() {
        const remainingMs = this.remainingMs();

        return {
            active: this.probeRequired,
            since: this.requiredSince > 0 ? new Date(this.requiredSince).toISOString() : null,
            nextProbeAt:
                this.probeRequired && this.openUntil > 0
                    ? new Date(this.openUntil).toISOString()
                    : null,
            probeInFlight: this.probeStartedAt > 0,
            retryAfterSeconds: Math.ceil(remainingMs / 1000),
            probes: this.probes
        };
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
            state: remainingMs > 0 ? "open" : this.probeRequired ? "half_open" : "closed",
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
