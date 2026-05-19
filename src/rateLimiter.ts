const requestTimestamps: number[] = [];

export class LocalRateLimitError extends Error {
    retryAfterMs: number;

    constructor(retryAfterMs: number) {
        super("Local upstream request limit reached");
        this.name = "LocalRateLimitError";
        this.retryAfterMs = retryAfterMs;
    }
}

export function assertCanCallUpstream(): void {
    const maxRequestsPerHour = Number(process.env.MYTT_MAX_REQUESTS_PER_HOUR ?? 60);
    const now = Date.now();
    const windowMs = 60 * 60 * 1000;
    const oneHourAgo = now - windowMs;

    while (requestTimestamps.length > 0 && requestTimestamps[0] < oneHourAgo) {
        requestTimestamps.shift();
    }

    if (requestTimestamps.length >= maxRequestsPerHour) {
        const oldestRequest = requestTimestamps[0];
        const retryAfterMs = Math.max(1000, oldestRequest + windowMs - now);

        throw new LocalRateLimitError(retryAfterMs);
    }

    requestTimestamps.push(now);
}