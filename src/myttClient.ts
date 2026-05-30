import {
    PlayerSearchResponseSchema,
    ClubSearchResponseSchema,
    ClubTeamsResponseSchema,
    LeagueTableResponseSchema,
    LeagueScheduleResponseSchema,
    LeagueScheduleResponse,
    MeetingLiveResponseSchema,
    MeetingLiveResponse,
    PlayerTtrResponseSchema,
    PlayerTtrHistoryResponseSchema,
    TeamPlayersResponseSchema,
    TeamSimpleScheduleResponseSchema,
    TeamInfoResponseSchema,
    TeamScheduleResponseSchema,
    TeamBalancesResponseSchema
} from "./schemas.js";

import type {
    PlayerSearchResponse,
    ClubSearchResponse,
    ClubTeamsResponse,
    LeagueTableResponse,
    PlayerTtrResponse,
    PlayerTtrHistoryResponse,
    TeamPlayersResponse,
    TeamSimpleScheduleResponse,
    TeamInfoResponse,
    TeamScheduleResponse,
    TeamBalancesResponse
} from "./schemas.js";

import {
    markMyttSessionExpired,
    MyttSessionExpiredError,
    resolveMyttSessionForRequest,
    type MyttScope,
    type ResolvedMyttSession
} from "./myttSessionStore.js";

import { getRequestContext } from "./requestContext.js";
import { writeJsonLog } from "./fileLogger.js";
import { assertCanCallUpstream, LocalRateLimitError } from "./rateLimiter.js";

const MYTT_BASE_URL =
    process.env.MYTT_BASE_URL ?? "https://www.mytischtennis.de";

const upstreamEnabled = process.env.MYTT_UPSTREAM_ENABLED !== "false";

function shouldCountTowardsLocalRateLimit(params: {
    path: string;
    countTowardsLocalRateLimit?: boolean;
}) {
    return params.countTowardsLocalRateLimit ?? !params.path.startsWith("/api/ttr/");
}

function getMyttHeaders(params?: {
    extraHeaders?: Record<string, string>;
    authenticated?: boolean;
    sessionCookie?: string;
}) {
    const headers: Record<string, string> = {
        accept: "application/json",
        ...params?.extraHeaders
    };

    if (params?.authenticated === true && params.sessionCookie) {
        headers.cookie = params.sessionCookie;
    }

    return headers;
}

function responseLooksLikeAuthExpired(response: Response, bodyText: string) {
    if ([401, 403, 419].includes(response.status)) {
        return true;
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (!contentType.includes("text/html")) {
        return false;
    }

    const lower = bodyText.toLowerCase();

    return (
        lower.includes('type="password"') &&
        (lower.includes("login") ||
            lower.includes("einloggen") ||
            lower.includes("anmelden"))
    );
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
    authenticated?: boolean;
    countTowardsLocalRateLimit?: boolean;
}): Promise<T> {
    if (!upstreamEnabled) {
        throw new UpstreamDisabledError();
    }

    const context = getRequestContext();

    const countTowardsLocalRateLimit = shouldCountTowardsLocalRateLimit(params);

    if (countTowardsLocalRateLimit) {
        try {
            assertCanCallUpstream();
        } catch (error) {
            void writeJsonLog("mytt_upstream_blocked", {
                requestId: context?.requestId,
                clientIp: context?.ip,
                backendMethod: context?.method,
                backendUrl: context?.url,
                reason: "local_rate_limit",
                myttMethod: "POST",
                myttPath: params.path
            });

            throw error;
        }
    }

    const url = `${MYTT_BASE_URL}${params.path}`;
    const startedAt = Date.now();

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: getMyttHeaders({
                authenticated: params.authenticated,
                extraHeaders: {
                    "content-type": "application/x-www-form-urlencoded"
                }
            }),
            body: params.body
        });

        void writeJsonLog("mytt_upstream_request", {
            requestId: context?.requestId,
            clientIp: context?.ip,
            backendMethod: context?.method,
            backendUrl: context?.url,
            myttMethod: "POST",
            myttPath: params.path,
            status: response.status,
            ok: response.ok,
            durationMs: Date.now() - startedAt,
            localRateLimitCounted: countTowardsLocalRateLimit
        });

        if (response.status === 429) {
            throw new UpstreamRateLimitError();
        }

        if (!response.ok) {
            throw new UpstreamError(`Upstream returned HTTP ${response.status}`);
        }

        const json = await response.json();

        return params.schema.parse(json);
    } catch (error) {
        void writeJsonLog("mytt_upstream_error", {
            requestId: context?.requestId,
            clientIp: context?.ip,
            backendMethod: context?.method,
            backendUrl: context?.url,
            myttMethod: "POST",
            myttPath: params.path,
            durationMs: Date.now() - startedAt,
            errorName: error instanceof Error ? error.name : "UnknownError",
            errorMessage: error instanceof Error ? error.message : "Unknown error"
        });

        throw error;
    }
}

async function getJsonFromMytt<T>(params: {
    path: string;
    searchParams?: URLSearchParams;
    schema: {
        parse: (value: unknown) => T;
    };
    authenticated?: boolean;
    requestingUserId?: string;
    requiredScope?: MyttScope;
    countTowardsLocalRateLimit?: boolean;
}): Promise<T> {
    if (!upstreamEnabled) {
        throw new UpstreamDisabledError();
    }

    const context = getRequestContext();

    let resolvedSession: ResolvedMyttSession | null = null;

    if (params.authenticated) {
        resolvedSession = await resolveMyttSessionForRequest({
            requesterUserId: params.requestingUserId ?? context?.appUserId ?? "",
            requiredScope: params.requiredScope ?? "ttr:read"
        });
    }

    const countTowardsLocalRateLimit = shouldCountTowardsLocalRateLimit(params);

    if (countTowardsLocalRateLimit) {
        try {
            assertCanCallUpstream();
        } catch (error) {
            void writeJsonLog("mytt_upstream_blocked", {
                requestId: context?.requestId,
                clientIp: context?.ip,
                backendMethod: context?.method,
                backendUrl: context?.url,
                reason: "local_rate_limit",
                myttMethod: "GET",
                myttPath: params.path
            });

            throw error;
        }
    }

    const url = new URL(`${MYTT_BASE_URL}${params.path}`);

    if (params.searchParams) {
        params.searchParams.forEach((value, key) => {
            url.searchParams.set(key, value);
        });
    }

    const urlString = url.toString();
    const startedAt = Date.now();

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: getMyttHeaders({
                authenticated: params.authenticated,
                sessionCookie: resolvedSession?.cookie
            })
        });

        void writeJsonLog("mytt_upstream_request", {
            requestId: context?.requestId,
            clientIp: context?.ip,
            backendMethod: context?.method,
            backendUrl: context?.url,
            myttMethod: "GET",
            myttPath: params.path,
            myttUrl: urlString,
            status: response.status,
            ok: response.ok,
            durationMs: Date.now() - startedAt,
            localRateLimitCounted: countTowardsLocalRateLimit,
            requesterUserId: resolvedSession?.requesterUserId,
            sessionOwnerUserId: resolvedSession?.sessionOwnerUserId,
            sessionMode: resolvedSession?.mode,
        });

        const bodyText = await response.text();

        if (
            params.authenticated &&
            resolvedSession &&
            responseLooksLikeAuthExpired(response, bodyText)
        ) {
            await markMyttSessionExpired(resolvedSession.sessionOwnerUserId);

            throw new MyttSessionExpiredError({
                sessionOwnerUserId: resolvedSession.sessionOwnerUserId,
                delegated: resolvedSession.mode === "delegated"
            });
        }

        if (response.status === 429) {
            throw new UpstreamRateLimitError();
        }

        if (!response.ok) {
            throw new UpstreamError(`Upstream returned HTTP ${response.status}`);
        }

        let json: unknown;

        try {
            json = JSON.parse(bodyText);
        } catch {
            throw new UpstreamError(
                `Upstream returned non-JSON response for ${params.path}`
            );
        }

        return params.schema.parse(json);
    } catch (error) {
        void writeJsonLog("mytt_upstream_error", {
            requestId: context?.requestId,
            clientIp: context?.ip,
            backendMethod: context?.method,
            backendUrl: context?.url,
            myttMethod: "GET",
            myttPath: params.path,
            myttUrl: urlString,
            durationMs: Date.now() - startedAt,
            errorName: error instanceof Error ? error.name : "UnknownError",
            errorMessage: error instanceof Error ? error.message : "Unknown error"
        });

        throw error;
    }
}

async function getTextFromMytt(params: {
    path: string;
    searchParams?: URLSearchParams;
    countTowardsLocalRateLimit?: boolean;
}): Promise<string> {
    if (!upstreamEnabled) {
        throw new UpstreamDisabledError();
    }

    const context = getRequestContext();

    const countTowardsLocalRateLimit = shouldCountTowardsLocalRateLimit(params);

    if (countTowardsLocalRateLimit) {
        try {
            assertCanCallUpstream();
        } catch (error) {
            void writeJsonLog("mytt_upstream_blocked", {
                requestId: context?.requestId,
                clientIp: context?.ip,
                backendMethod: context?.method,
                backendUrl: context?.url,
                reason: "local_rate_limit",
                myttMethod: "GET",
                myttPath: params.path
            });

            throw error;
        }
    }

    const url = new URL(`${MYTT_BASE_URL}${params.path}`);

    if (params.searchParams) {
        params.searchParams.forEach((value, key) => {
            url.searchParams.set(key, value);
        });
    }

    const urlString = url.toString();
    const startedAt = Date.now();

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                accept: "text/html,application/xhtml+xml,*/*",
                "user-agent": "Mozilla/5.0 (compatible; TischtennisTracker/1.0)"
            }
        });

        void writeJsonLog("mytt_upstream_request", {
            requestId: context?.requestId,
            clientIp: context?.ip,
            backendMethod: context?.method,
            backendUrl: context?.url,
            myttMethod: "GET",
            myttPath: params.path,
            myttUrl: urlString,
            status: response.status,
            ok: response.ok,
            durationMs: Date.now() - startedAt,
            localRateLimitCounted: countTowardsLocalRateLimit
        });

        if (response.status === 429) {
            throw new UpstreamRateLimitError();
        }

        if (!response.ok) {
            throw new UpstreamError(`Upstream returned HTTP ${response.status}`);
        }

        return response.text();
    } catch (error) {
        void writeJsonLog("mytt_upstream_error", {
            requestId: context?.requestId,
            clientIp: context?.ip,
            backendMethod: context?.method,
            backendUrl: context?.url,
            myttMethod: "GET",
            myttPath: params.path,
            myttUrl: urlString,
            durationMs: Date.now() - startedAt,
            errorName: error instanceof Error ? error.name : "UnknownError",
            errorMessage: error instanceof Error ? error.message : "Unknown error"
        });

        throw error;
    }
}

type PromotionState = "promotion" | "relegation" | "none";

function extractPromotionStatesFromTableHtml(html: string): PromotionState[] {
    const rows = html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];

    return rows
        .filter((row) => {
            const text = row
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim();

            // Header-Zeilen rausfiltern
            return text.length > 0 && !/^rang\s+mannschaft/i.test(text);
        })
        .map((row): PromotionState => {
            if (/#rise(?:["'#\s>]|$)/i.test(row)) {
                return "promotion";
            }

            if (/#fall(?:["'#\s>]|$)/i.test(row)) {
                return "relegation";
            }

            return "none";
        });
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

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }

    return value as Record<string, unknown>;
}

function normalizeFrontendLeagueTableResponse(value: unknown): LeagueTableResponse {
    const root = asRecord(value);
    const data = asRecord(root.data);

    const rows =
        Array.isArray(root.data)
            ? root.data
            : Array.isArray(data.league_table)
                ? data.league_table
                : Array.isArray(root.league_table)
                    ? root.league_table
                    : [];

    return LeagueTableResponseSchema.parse({
        data: rows,
        error: root.error ?? data.error ?? null
    });
}

export async function getLeagueTable(params: {
    association: string;
    season: string;
    groupId: string;
    leagueSlug?: string;
    filter?: "gesamt" | "vr" | "rr";
}): Promise<LeagueTableResponse> {
    const filter = params.filter ?? "gesamt";
    const leagueSlug = toLeagueSlug(params.leagueSlug);

    const path = `/click-tt/${encodeURIComponent(
        params.association
    )}/${encodeURIComponent(params.season)}/ligen/${encodeURIComponent(
        leagueSlug
    )}/gruppe/${encodeURIComponent(params.groupId)}/tabelle/${encodeURIComponent(
        filter
    )}`;

    const searchParams = new URLSearchParams({
        _data:
            "routes/click-tt+/$association+/$season+/$type+/$groupname.gruppe.$urlid+/tabelle.$filter"
    });

    const jsonResult = await getJsonFromMytt({
        path,
        searchParams,
        schema: {
            parse: normalizeFrontendLeagueTableResponse
        }
    });

    let promotionStates: PromotionState[] = [];

    try {
        const html = await getTextFromMytt({
            path,
            countTowardsLocalRateLimit: true
        });

        promotionStates = extractPromotionStatesFromTableHtml(html);
    } catch {
        promotionStates = [];
    }

    return {
        ...jsonResult,
        data: jsonResult.data.map((row, index) => ({
            ...row,
            promotion_state: promotionStates[index] ?? "none"
        }))
    };
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

export async function getPlayerTtr(params: {
    requestingUserId: string;
    nuid: string;
}): Promise<PlayerTtrResponse> {
    return getJsonFromMytt({
        path: `/api/ttr/player/${encodeURIComponent(params.nuid)}`,
        schema: PlayerTtrResponseSchema,
        authenticated: true,
        requestingUserId: params.requestingUserId,
        requiredScope: "ttr:read",
        countTowardsLocalRateLimit: false
    });
}

export async function getPlayerTtrHistory(params: {
    requestingUserId: string;
    nuid: string;
}): Promise<PlayerTtrHistoryResponse> {
    return getJsonFromMytt({
        path: `/api/ttr/history/${encodeURIComponent(params.nuid)}`,
        schema: PlayerTtrHistoryResponseSchema,
        authenticated: true,
        requestingUserId: params.requestingUserId,
        requiredScope: "ttr_history:read",
        countTowardsLocalRateLimit: false
    });
}

type TeamRoundFilter = "gesamt" | "vr" | "rr";

function buildTeamContextPath(params: {
    association: string;
    season: string;
    groupId: string;
    leagueSlug?: string;
    teamId: string;
    teamNameSlug?: string;
    page: "infos" | "spielplan" | "spielerbilanzen";
    filter?: TeamRoundFilter;
}) {
    const leagueSlug = toLeagueSlug(params.leagueSlug);
    const teamNameSlug = params.teamNameSlug?.trim() || "x";

    const segments = [
        "click-tt",
        params.association,
        params.season,
        "ligen",
        leagueSlug,
        "gruppe",
        params.groupId,
        "mannschaft",
        params.teamId,
        teamNameSlug,
        params.page
    ];

    if (params.filter) {
        segments.push(params.filter);
    }

    return `/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

export async function getTeamPlayers(params: {
    teamId: string;
}): Promise<TeamPlayersResponse> {
    const searchParams = new URLSearchParams({
        teamId: params.teamId
    });

    return getJsonFromMytt({
        path: "/api/ttr/team/players",
        searchParams,
        schema: TeamPlayersResponseSchema
    });
}

export async function getTeamSimpleSchedule(params: {
    teamId: string;
    season: string;
}): Promise<TeamSimpleScheduleResponse> {
    const searchParams = new URLSearchParams({
        teamId: params.teamId,
        season: params.season
    });

    return getJsonFromMytt({
        path: "/api/ttr/team/schedule",
        searchParams,
        schema: TeamSimpleScheduleResponseSchema
    });
}

export async function getTeamInfos(params: {
    association: string;
    season: string;
    groupId: string;
    leagueSlug?: string;
    teamId: string;
    teamNameSlug?: string;
}): Promise<TeamInfoResponse> {
    const searchParams = new URLSearchParams({
        _data:
            "routes/click-tt+/$association+/$season+/$type+/($groupname).gruppe.$urlid_.mannschaft.$teamid.$teamname+/infos"
    });

    return getJsonFromMytt({
        path: buildTeamContextPath({
            ...params,
            page: "infos"
        }),
        searchParams,
        schema: TeamInfoResponseSchema
    });
}

export async function getTeamSchedule(params: {
    association: string;
    season: string;
    groupId: string;
    leagueSlug?: string;
    teamId: string;
    teamNameSlug?: string;
    filter?: TeamRoundFilter;
}): Promise<TeamScheduleResponse> {
    const filter = params.filter ?? "gesamt";

    const searchParams = new URLSearchParams({
        _data:
            "routes/click-tt+/$association+/$season+/$type+/($groupname).gruppe.$urlid_.mannschaft.$teamid.$teamname+/spielplan.$filter"
    });

    return getJsonFromMytt({
        path: buildTeamContextPath({
            ...params,
            page: "spielplan",
            filter
        }),
        searchParams,
        schema: TeamScheduleResponseSchema
    });
}

export async function getTeamBalances(params: {
    association: string;
    season: string;
    groupId: string;
    leagueSlug?: string;
    teamId: string;
    teamNameSlug?: string;
    filter?: TeamRoundFilter;
}): Promise<TeamBalancesResponse> {
    const filter = params.filter ?? "gesamt";

    const searchParams = new URLSearchParams({
        _data:
            "routes/click-tt+/$association+/$season+/$type+/($groupname).gruppe.$urlid_.mannschaft.$teamid.$teamname+/spielerbilanzen.$filter"
    });

    return getJsonFromMytt({
        path: buildTeamContextPath({
            ...params,
            page: "spielerbilanzen",
            filter
        }),
        searchParams,
        schema: TeamBalancesResponseSchema
    });
}