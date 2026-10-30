export class UpstreamError extends Error {
    constructor(
        message: string,
        // HTTP Status, wenn myTischtennis geantwortet hat. Ohne Status: Netzwerk, Timeout, falsches Format.
        readonly status?: number
    ) {
        super(message);
        this.name = "UpstreamError";
    }
}

export class UpstreamRateLimitError extends Error {
    constructor() {
        super("myTischtennis rate limit reached");
        this.name = "UpstreamRateLimitError";
    }
}

/**
 * myTischtennis leitet den Request auf die Verifizierungsseite (/verify, Bot Schutz mit Captcha)
 * um. Das ist kein Rate Limit, sondern eine Sperre der Server IP. Wird nie umgangen.
 */
export class UpstreamChallengeError extends Error {
    constructor(readonly location?: string) {
        super("myTischtennis requires a human verification for this IP");
        this.name = "UpstreamChallengeError";
    }
}

/** myTischtennis hat geantwortet, aber die Daten passen nicht mehr zum erwarteten Format. */
export class UpstreamFormatError extends Error {
    constructor(
        readonly source: string,
        readonly issues: string[]
    ) {
        super(`Unexpected upstream data format in ${source}: ${issues.join("; ")}`);
        this.name = "UpstreamFormatError";
    }
}

export class UpstreamDisabledError extends Error {
    constructor() {
        super("myTischtennis upstream disabled");
        this.name = "UpstreamDisabledError";
    }
}

// breaker_open: myTischtennis hat gebremst (429 oder Kontingent fast leer).
// upstream_unavailable: myTischtennis hing oder lieferte 5xx, der Breaker schont es kurz.
// upstream_challenge: myTischtennis verlangt eine Verifizierung, bis zur nächsten Probe wird nichts gesendet.
export type LocalRateLimitReason =
    | "hourly_cap"
    | "queue_full"
    | "breaker_open"
    | "upstream_unavailable"
    | "upstream_challenge";

/** Ein eigenes Limit greift, myTischtennis selbst wurde nicht angefragt. */
export class LocalRateLimitError extends Error {
    constructor(
        readonly retryAfterMs: number,
        readonly reason: LocalRateLimitReason = "hourly_cap"
    ) {
        super(
            reason === "breaker_open" ||
                reason === "upstream_unavailable" ||
                reason === "upstream_challenge"
                ? "myTischtennis is temporarily paused"
                : "Local upstream request limit reached"
        );
        this.name = "LocalRateLimitError";
    }
}
