const requestTimestamps: number[] = [];

export class LocalRateLimitError extends Error {
    constructor() {
        super("Local upstream request limit reached");
        this.name = "LocalRateLimitError";
    }
}

export function assertCanCallUpstream(): void {
    const maxRequestsPerHour = Number(process.env.MYTT_MAX_REQUESTS_PER_HOUR ?? 60);
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    while (requestTimestamps.length > 0 && requestTimestamps[0] < oneHourAgo) {
        requestTimestamps.shift();
    }

    if (requestTimestamps.length >= maxRequestsPerHour) {
        throw new LocalRateLimitError();
    }

    requestTimestamps.push(now);
}