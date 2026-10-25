import {
    TeamBalancesResponseSchema,
    TeamInfoResponseSchema,
    TeamPlayersResponseSchema,
    TeamScheduleResponseSchema,
    TeamSimpleScheduleResponseSchema
} from "../schemas.js";
import type {
    TeamBalancesResponse,
    TeamInfoResponse,
    TeamPlayersResponse,
    TeamScheduleResponse,
    TeamSimpleScheduleResponse
} from "../schemas.js";
import { toLeagueSlug } from "./league.js";
import { getJsonFromMytt, getRouteDataWithHtmlFallback } from "./request.js";

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

    return getRouteDataWithHtmlFallback({
        name: "team_infos",
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

    return getRouteDataWithHtmlFallback({
        name: "team_schedule",
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

    return getRouteDataWithHtmlFallback({
        name: "team_balances",
        path: buildTeamContextPath({
            ...params,
            page: "spielerbilanzen",
            filter
        }),
        searchParams,
        schema: TeamBalancesResponseSchema
    });
}
