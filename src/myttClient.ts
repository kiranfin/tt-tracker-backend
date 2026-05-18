import {
    PlayerSearchResponseSchema,
    ClubSearchResponseSchema,
    ClubTeamsResponseSchema,
    LeagueTableResponseSchema, LeagueScheduleResponseSchema, LeagueScheduleResponse, MeetingLiveResponseSchema,
    MeetingLiveResponse
} from "./schemas.js";

import type {
    PlayerSearchResponse,
    ClubSearchResponse,
    ClubTeamsResponse,
    LeagueTableResponse
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

async function getJsonFromMytt<T>(params: {
    path: string;
    searchParams?: URLSearchParams;
    schema: {
        parse: (value: unknown) => T;
    };
}): Promise<T> {
    if (!upstreamEnabled) {
        throw new UpstreamDisabledError();
    }

    assertCanCallUpstream();

    const url = new URL(`${MYTT_BASE_URL}${params.path}`);

    if (params.searchParams) {
        params.searchParams.forEach((value, key) => {
            url.searchParams.set(key, value);
        });
    }

    const response = await fetch(url, {
        method: "GET",
        headers: {
            accept: "application/json"
        }
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

export async function getClubTeams(params: {
    clubNumber: string;
    organization: string;
}): Promise<ClubTeamsResponse> {
    const searchParams = new URLSearchParams({
        clubNumber: params.clubNumber,
        organization: params.organization
    });

    return getJsonFromMytt({
        path: "/api/ttr/teams",
        searchParams,
        schema: ClubTeamsResponseSchema
    });
}

export async function getLeagueTable(params: {
    association: string;
    groupId: string;
}): Promise<LeagueTableResponse> {
    return getJsonFromMytt({
        path: `/api/league-table/${encodeURIComponent(
            params.association
        )}/${encodeURIComponent(params.groupId)}`,
        schema: LeagueTableResponseSchema
    });
}

function toLeagueSlug(value: string | undefined): string {
    if (!value || value.trim().length === 0) {
        return "x";
    }

    return value
        .trim()
        .replaceAll("ä", "ae")
        .replaceAll("ö", "oe")
        .replaceAll("ü", "ue")
        .replaceAll("Ä", "Ae")
        .replaceAll("Ö", "Oe")
        .replaceAll("Ü", "Ue")
        .replaceAll("ß", "ss")
        .replaceAll(/[^a-zA-Z0-9]+/g, "_")
        .replaceAll(/^_+|_+$/g, "");
}

export async function getLeagueSchedule(params: {
    association: string;
    season: string;
    groupId: string;
    leagueSlug?: string;
    filter?: "gesamt" | "vr" | "rr";
}): Promise<LeagueScheduleResponse> {
    const filter = params.filter ?? "gesamt";
    const leagueSlug = toLeagueSlug(params.leagueSlug);

    const searchParams = new URLSearchParams({
        _data:
            "routes/click-tt+/$association+/$season+/$type+/$groupname.gruppe.$urlid+/spielplan.$filter"
    });

    return getJsonFromMytt({
        path: `/click-tt/${encodeURIComponent(
            params.association
        )}/${encodeURIComponent(params.season)}/ligen/${encodeURIComponent(
            leagueSlug
        )}/gruppe/${encodeURIComponent(params.groupId)}/spielplan/${encodeURIComponent(
            filter
        )}`,
        searchParams,
        schema: LeagueScheduleResponseSchema
    });
}

export async function getMeetingLive(params: {
    meetingId: string;
}): Promise<MeetingLiveResponse> {
    return getJsonFromMytt({
        path: `/api/meeting/${encodeURIComponent(params.meetingId)}/live`,
        schema: MeetingLiveResponseSchema
    });
}