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
export type LocalRateLimitReason =
    | "hourly_cap"
    | "queue_full"
    | "breaker_open"
    | "upstream_unavailable";

/** Ein eigenes Limit greift, myTischtennis selbst wurde nicht angefragt. */
export class LocalRateLimitError extends Error {
    constructor(
        readonly retryAfterMs: number,
        readonly reason: LocalRateLimitReason = "hourly_cap"
    ) {
        super(
            reason === "breaker_open" || reason === "upstream_unavailable"
                ? "myTischtennis is temporarily paused"
                : "Local upstream request limit reached"
        );
        this.name = "LocalRateLimitError";
    }
}
