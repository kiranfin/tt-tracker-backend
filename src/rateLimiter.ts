const upstreamRequestTimestamps: number[] = [];
const htmlFallbackRequestTimestamps: number[] = [];

const WINDOW_MS = 60 * 60 * 1000;

export class LocalRateLimitError extends Error {
    retryAfterMs: number;

    constructor(retryAfterMs: number) {
        super("Local upstream request limit reached");
        this.name = "LocalRateLimitError";
        this.retryAfterMs = retryAfterMs;
    }
}

export class LocalHtmlRateLimitError extends LocalRateLimitError {
    constructor(retryAfterMs: number) {
        super(retryAfterMs);
        this.name = "LocalHtmlRateLimitError";
        this.message = "Local HTML fallback request limit reached";
    }
}

function readPositiveNumberFromEnv(params: {
    key: string;
    fallback: number;
}): number {
    const raw = process.env[params.key];

    if (!raw || raw.trim() === "") {
        return params.fallback;
    }

    const parsed = Number(raw);

    if (!Number.isFinite(parsed) || parsed < 1) {
        console.warn(
            `Invalid ${params.key}="${raw}", falling back to ${params.fallback}`
        );
        return params.fallback;
    }

    return parsed;
}

function getMaxUpstreamRequestsPerHour(): number {
    return readPositiveNumberFromEnv({
        key: "MYTT_MAX_REQUESTS_PER_HOUR",
        fallback: 60
    });
}

function getMaxHtmlFallbackRequestsPerHour(): number {
    return readPositiveNumberFromEnv({
        key: "MYTT_HTML_MAX_REQUESTS_PER_HOUR",
        fallback: 30
    });
}

function cleanupOldRequests(timestamps: number[]) {
    const oneHourAgo = Date.now() - WINDOW_MS;

    while (timestamps.length > 0 && timestamps[0] < oneHourAgo) {
        timestamps.shift();
    }
}

function getBucketStatus(params: { timestamps: number[]; max: number }) {
    cleanupOldRequests(params.timestamps);

    const used = params.timestamps.length;
    const remaining = Math.max(0, params.max - used);

    const resetInMs =
        params.timestamps.length > 0
            ? Math.max(0, params.timestamps[0] + WINDOW_MS - Date.now())
            : 0;

    return {
        max: params.max,
        used,
        remaining,
        resetInMs,
        resetInSeconds: Math.ceil(resetInMs / 1000),
        resetAt:
            resetInMs > 0
                ? new Date(Date.now() + resetInMs).toISOString()
                : null
    };
}

function assertCanUseBucket(params: {
    timestamps: number[];
    max: number;
    createError: (retryAfterMs: number) => Error;
}) {
    cleanupOldRequests(params.timestamps);

    const now = Date.now();

    if (params.timestamps.length >= params.max) {
        const oldestRequest = params.timestamps[0];
        const retryAfterMs = Math.max(1000, oldestRequest + WINDOW_MS - now);

        throw params.createError(retryAfterMs);
    }

    params.timestamps.push(now);
}

export function getRateLimitStatus() {
    return {
        upstream: getBucketStatus({
            timestamps: upstreamRequestTimestamps,
            max: getMaxUpstreamRequestsPerHour()
        }),
        htmlFallback: getBucketStatus({
            timestamps: htmlFallbackRequestTimestamps,
            max: getMaxHtmlFallbackRequestsPerHour()
        })
    };
}

export function assertCanCallUpstream(): void {
    assertCanUseBucket({
        timestamps: upstreamRequestTimestamps,
        max: getMaxUpstreamRequestsPerHour(),
        createError: (retryAfterMs) => new LocalRateLimitError(retryAfterMs)
    });
}

export function assertCanCallHtmlFallback(): void {
    assertCanUseBucket({
        timestamps: htmlFallbackRequestTimestamps,
        max: getMaxHtmlFallbackRequestsPerHour(),
        createError: (retryAfterMs) => new LocalHtmlRateLimitError(retryAfterMs)
    });
}