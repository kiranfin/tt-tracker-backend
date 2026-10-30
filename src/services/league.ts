import { cacheKeys } from "../cacheKeys.js";
import {
    ASSOCIATIONS,
    loadLeagueClasses,
    loadLeagueRegions,
    normalizeSeason,
    resolveAssociation
} from "../mytt/leagueDiscovery.js";
import { getLeagueSchedule, getLeagueTable } from "../mytt/league.js";
import type { LeagueScheduleResponse } from "../schemas.js";
import { leagueScheduleDates } from "../sources/scheduleDates.js";
import { matchWindowFromCachedSchedule, readByPolicy } from "./read.js";

export { ASSOCIATIONS, normalizeSeason, resolveAssociation };

export type RoundFilter = "gesamt" | "vr" | "rr";

export type LeagueRef = {
    association: string;
    season: string;
    groupId: string;
    leagueSlug: string;
    filter: RoundFilter;
};

export function getLeagueRegions(params: { association: string; season: string }) {
    return readByPolicy({
        kind: "LEAGUE_REGIONS",
        key: cacheKeys.leagueRegions(params.association, params.season),
        load: () => loadLeagueRegions(params.association, params.season),
        extraMeta: () => ({ association: params.association, season: params.season })
    });
}

export function getLeagueClasses(params: {
    association: string;
    season: string;
    championship: string;
    competitionType: "ligen" | "pokalspiele";
}) {
    return readByPolicy({
        kind: "LEAGUE_CLASSES",
        key: cacheKeys.leagueClasses(
            params.association,
            params.season,
            params.competitionType,
            params.championship
        ),
        load: () => loadLeagueClasses(params),
        extraMeta: (value) => ({
            association: params.association,
            season: params.season,
            championship: params.championship,
            competitionType: params.competitionType,
            strategy: value.strategy
        })
    });
}

function leagueScheduleKey(params: LeagueRef) {
    return cacheKeys.leagueSchedule(
        params.association,
        params.season,
        params.groupId,
        params.leagueSlug,
        params.filter
    );
}

export function getLeagueTableData(params: LeagueRef) {
    return readByPolicy({
        kind: "LEAGUE_TABLE",
        key: cacheKeys.leagueTable(
            params.association,
            params.season,
            params.groupId,
            params.leagueSlug,
            params.filter
        ),
        load: () => getLeagueTable(params),
        // Die Tabelle ändert sich nur nach Spieltagen: das Fenster kommt aus dem Liga Spielplan.
        freshContext: () => ({
            matchWindow: matchWindowFromCachedSchedule<LeagueScheduleResponse>(
                leagueScheduleKey(params),
                leagueScheduleDates
            )
        })
    });
}

export function getLeagueScheduleData(params: LeagueRef) {
    return readByPolicy({
        kind: "LEAGUE_SCHEDULE",
        key: leagueScheduleKey(params),
        load: () => getLeagueSchedule(params)
    });
}
