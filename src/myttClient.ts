import { PlayerSearchResponseSchema } from "./schemas.js";
import type { PlayerSearchResponse } from "./schemas.js";
import { assertCanCallUpstream, LocalRateLimitError } from "./rateLimiter.js";

const MYTT_BASE_URL =
    process.env.MYTT_BASE_URL ?? "https://www.mytischtennis.de";

const upstreamEnabled = process.env.MYTT_UPSTREAM_ENABLED !== "false";

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

export class UpstreamError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "UpstreamError";
    }
}

export { LocalRateLimitError };

export async function searchPlayers(params: {
    query: string;
    page?: number;
    pagesize?: number;
}): Promise<PlayerSearchResponse> {
    if (!upstreamEnabled) {
        throw new UpstreamDisabledError();
    }

    assertCanCallUpstream();

    const body = new URLSearchParams({
        query: params.query,
        page: String(params.page ?? 1),
        pagesize: String(params.pagesize ?? 8)
    });

    const response = await fetch(`${MYTT_BASE_URL}/api/search/players`, {
        method: "POST",
        headers: {
            "content-type": "application/x-www-form-urlencoded",
            "accept": "application/json"
        },
        body
    });

    if (response.status === 429) {
        throw new UpstreamRateLimitError();
    }

    if (!response.ok) {
        throw new UpstreamError(`Upstream returned HTTP ${response.status}`);
    }

    const json = await response.json();

    return PlayerSearchResponseSchema.parse(json);
}