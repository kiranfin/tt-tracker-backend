import {
    PlayerSearchResponseSchema,
    ClubSearchResponseSchema
} from "./schemas.js";

import type {
    PlayerSearchResponse,
    ClubSearchResponse
} from "./schemas.js";

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

async function postFormToMytt<T>(params: {
    path: string;
    body: URLSearchParams;
    schema: {
        parse: (value: unknown) => T;
    };
}): Promise<T> {
    if (!upstreamEnabled) {
        throw new UpstreamDisabledError();
    }

    assertCanCallUpstream();

    const response = await fetch(`${MYTT_BASE_URL}${params.path}`, {
        method: "POST",
        headers: {
            "content-type": "application/x-www-form-urlencoded",
            accept: "application/json"
        },
        body: params.body
    });

    if (response.status === 429) {
        throw new UpstreamRateLimitError();
    }

    if (!response.ok) {
        throw new UpstreamError(`Upstream returned HTTP ${response.status}`);
    }

    const json = await response.json();

    return params.schema.parse(json);
}

export async function searchPlayers(params: {
    query: string;
    page?: number;
    pagesize?: number;
}): Promise<PlayerSearchResponse> {
    const body = new URLSearchParams({
        query: params.query,
        page: String(params.page ?? 1),
        pagesize: String(params.pagesize ?? 8)
    });

    return postFormToMytt({
        path: "/api/search/players",
        body,
        schema: PlayerSearchResponseSchema
    });
}

export async function searchClubs(params: {
    query: string;
    page?: number;
    pagesize?: number;
}): Promise<ClubSearchResponse> {
    const body = new URLSearchParams({
        query: params.query,
        page: String(params.page ?? 1),
        pagesize: String(params.pagesize ?? 8)
    });

    return postFormToMytt({
        path: "/api/search/clubs",
        body,
        schema: ClubSearchResponseSchema
    });
}