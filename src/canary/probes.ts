import { parseUpstream } from "../upstream/parse.js";
import { parseLeagueTableFromHtmlTable } from "../sources/html/leagueTable.js";
import type { JsonRecord } from "../sources/html/remixContext.js";
import {
    validateClubSchedule,
    validateLeagueSchedule,
    validateLeagueTable,
    validateTeamSchedule
} from "../sources/validate.js";
import {
    ClubScheduleResponseSchema,
    LeagueScheduleResponseSchema,
    TeamBalancesResponseSchema,
    TeamInfoResponseSchema,
    TeamScheduleResponseSchema
} from "../schemas.js";
import {
    ANDRO_RANKING_HEADERS,
    ANDRO_RANKING_PATH,
    buildAndroRankingSearchParams,
    getAndroEntriesCount
} from "../mytt/androRanking.js";
import { buildClubContextPath, CLUB_SCHEDULE_ROUTE_ID } from "../mytt/club.js";
import {
    buildLeaguePagePath,
    LEAGUE_SCHEDULE_ROUTE_ID,
    LEAGUE_TABLE_ROUTE_ID,
    normalizeFrontendLeagueTableResponse
} from "../mytt/league.js";
import {
    buildTeamContextPath,
    TEAM_BALANCES_ROUTE_ID,
    TEAM_INFOS_ROUTE_ID,
    TEAM_SCHEDULE_ROUTE_ID
} from "../mytt/team.js";

export type CanaryProbe = {
    name: string;
    path: string;
    // Enthält `_data=<routeId>` für den JSON Weg.
    searchParams: URLSearchParams;
    routeId: string;
    extraHeaders?: Record<string, string>;
    // Prüfung der Daten gegen Schema und Plausibilitätsregeln. Wirft bei Verstoß.
    check: (value: unknown, source: string) => void;
    // Zusätzliche Prüfung gegen die Webseite, liefert Gründe für eine Abweichung.
    compareWithPage?: (params: { html: string; routeData: JsonRecord }) => string[];
};

// Alte Saison: die Daten ändern sich nicht mehr, ein Unterschied kommt vom Format, nicht von neuen Spielen.
const SEASON = "25--26";
const LEAGUE = { association: "TTBW", season: SEASON, groupId: "494678" };
const TEAM = {
    association: "DTTB",
    season: SEASON,
    groupId: "493079",
    teamId: "2953148"
};
const CLUB = { association: "TTBW", season: SEASON, clubNumber: "2055064" };
const ANDRO = { organization: "TTBW", androClubNr: "2055064" };

const dataParam = (routeId: string, extra?: Record<string, string>) =>
    new URLSearchParams({ _data: routeId, ...extra });

// Ligatabelle: der Parser der sichtbaren Tabelle muss zu den Loader Daten passen.
function compareLeagueTableWithHtml(params: { html: string; routeData: JsonRecord }) {
    const loader = normalizeFrontendLeagueTableResponse(params.routeData).data;
    const visible = parseLeagueTableFromHtmlTable(params.html).data;
    const reasons: string[] = [];

    if (loader.length !== visible.length) {
        reasons.push(`table has ${visible.length} visible rows but ${loader.length} loader rows`);
    }

    loader.forEach((row, index) => {
        const other = visible[index];

        if (!other) {
            return;
        }

        for (const key of ["table_rank", "team_name", "points_won"] as const) {
            if (String(row[key] ?? "") !== String(other[key] ?? "")) {
                reasons.push(`row ${index + 1}: ${key} is "${row[key]}" in loader data but "${other[key]}" in the table`);
            }
        }
    });

    return reasons.slice(0, 5);
}

function teamProbe(
    name: string,
    page: "infos" | "spielplan" | "spielerbilanzen",
    routeId: string,
    check: CanaryProbe["check"]
): CanaryProbe {
    return {
        name,
        path: buildTeamContextPath({
            ...TEAM,
            leagueSlug: "x",
            teamNameSlug: "x",
            page,
            filter: page === "infos" ? undefined : "gesamt"
        }),
        searchParams: dataParam(routeId),
        routeId,
        check
    };
}

export const CANARY_PROBES: CanaryProbe[] = [
    {
        name: "league_table",
        path: buildLeaguePagePath({ ...LEAGUE, page: "tabelle" }),
        searchParams: dataParam(LEAGUE_TABLE_ROUTE_ID),
        routeId: LEAGUE_TABLE_ROUTE_ID,
        check: (value, source) => {
            validateLeagueTable(normalizeFrontendLeagueTableResponse(value), source);
        },
        compareWithPage: compareLeagueTableWithHtml
    },
    {
        name: "league_schedule",
        path: buildLeaguePagePath({ ...LEAGUE, page: "spielplan" }),
        searchParams: dataParam(LEAGUE_SCHEDULE_ROUTE_ID),
        routeId: LEAGUE_SCHEDULE_ROUTE_ID,
        check: (value, source) => {
            validateLeagueSchedule(parseUpstream(LeagueScheduleResponseSchema, value, source), source);
        }
    },
    teamProbe("team_infos", "infos", TEAM_INFOS_ROUTE_ID, (value, source) => {
        parseUpstream(TeamInfoResponseSchema, value, source);
    }),
    teamProbe("team_schedule", "spielplan", TEAM_SCHEDULE_ROUTE_ID, (value, source) => {
        validateTeamSchedule(parseUpstream(TeamScheduleResponseSchema, value, source), source);
    }),
    teamProbe("team_balances", "spielerbilanzen", TEAM_BALANCES_ROUTE_ID, (value, source) => {
        parseUpstream(TeamBalancesResponseSchema, value, source);
    }),
    {
        name: "club_schedule",
        path: buildClubContextPath({ ...CLUB, clubSlug: "x", page: "spielplan" }),
        searchParams: dataParam(CLUB_SCHEDULE_ROUTE_ID, {
            date_start: "2025-07-01",
            date_end: "2026-06-30"
        }),
        routeId: CLUB_SCHEDULE_ROUTE_ID,
        check: (value, source) => {
            validateClubSchedule(parseUpstream(ClubScheduleResponseSchema, value, source), source);
        }
    },
    {
        name: "andro_ranking",
        path: ANDRO_RANKING_PATH,
        searchParams: buildAndroRankingSearchParams(ANDRO),
        routeId: "routes/$",
        extraHeaders: ANDRO_RANKING_HEADERS,
        check: (value) => {
            if (getAndroEntriesCount(value) === 0) {
                throw new Error("ranking has no entries");
            }
        }
    }
];
