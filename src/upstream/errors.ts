export class UpstreamError extends Error {
    constructor(message: string) {
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

export class UpstreamDisabledError extends Error {
    constructor() {
        super("myTischtennis upstream disabled");
        this.name = "UpstreamDisabledError";
    }
}

export type LocalRateLimitReason = "hourly_cap" | "queue_full" | "breaker_open";

/** Ein eigenes Limit greift, myTischtennis selbst wurde nicht angefragt. */
export class LocalRateLimitError extends Error {
    constructor(
        readonly retryAfterMs: number,
        readonly reason: LocalRateLimitReason = "hourly_cap"
    ) {
        super(
            reason === "breaker_open"
                ? "myTischtennis is temporarily paused"
                : "Local upstream request limit reached"
        );
        this.name = "LocalRateLimitError";
    }
}
