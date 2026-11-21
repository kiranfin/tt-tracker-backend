import { cacheKeys } from "../cacheKeys.js";
import {
    getTeamBalances,
    getTeamInfos,
    getTeamPlayers,
    getTeamSchedule,
    getTeamSimpleSchedule,
    type TeamPagesStore
} from "../mytt/team.js";
import { peekCached, peekUsableCached, putCached } from "../cache/index.js";
import { DATA_POLICIES, getFreshMs } from "../policies.js";
import type { ClubTeamsResponse, TeamScheduleResponse } from "../schemas.js";
import type { JsonRecord } from "../sources/html/remixContext.js";
import { teamScheduleDates } from "../sources/scheduleDates.js";
import { matchWindowFromCachedSchedule, readByPolicy } from "./read.js";

export type TeamRef = {
    association: string;
    season: string;
    groupId: string;
    leagueSlug: string;
    teamId: string;
    teamNameSlug: string;
};

type RoundFilter = "gesamt" | "vr" | "rr";

/**
 * Ablage für den HTML Fallback der Teamspieler im normalen Cache. Die Vereinsliste liegt unter demselben Key
 * wie die der Vereinsroute: die Liste von der Vereinsseite hat dieselben Zeilen wie die der API, dazu Nummer
 * und Wettbewerb. Gelesen wird sie auch abgelaufen (Team IDs ändern sich in einer Saison nicht, fehlt eine,
 * holt der Fallback die Seite neu). Die Meldung gilt nur frisch, sie ändert sich mit Nachmeldungen.
 */
const teamPagesStore: TeamPagesStore = {
    getClubTeams: (organization, clubNumber) =>
        peekUsableCached<ClubTeamsResponse>(cacheKeys.clubTeams(organization, clubNumber)),
    putClubTeams: (organization, clubNumber, teams) =>
        putCached(
            cacheKeys.clubTeams(organization, clubNumber),
            teams,
            getFreshMs("CLUB_TEAMS", teams),
            DATA_POLICIES.CLUB_TEAMS.staleMax,
            "html"
        ),
    getLineup: (ref) => peekCached<JsonRecord>(cacheKeys.clubLineup(ref)),
    putLineup: (ref, routeData) =>
        putCached(
            cacheKeys.clubLineup(ref),
            routeData,
            getFreshMs("CLUB_LINEUP", routeData),
            DATA_POLICIES.CLUB_LINEUP.staleMax,
            "html"
        )
};

export function getTeamPlayerList(teamId: string) {
    return readByPolicy({
        kind: "TEAM_PLAYERS",
        key: cacheKeys.teamPlayers(teamId),
        load: () => getTeamPlayers({ teamId }, teamPagesStore)
    });
}

export function getTeamSimpleScheduleData(teamId: string, season: string) {
    return readByPolicy({
        kind: "TEAM_SIMPLE_SCHEDULE",
        key: cacheKeys.teamSimpleSchedule(teamId, season),
        load: () => getTeamSimpleSchedule({ teamId, season })
    });
}

export function getTeamInfoData(team: TeamRef) {
    return readByPolicy({
        kind: "TEAM_INFOS",
        key: cacheKeys.teamInfos(team),
        load: () => getTeamInfos(team)
    });
}

export function getTeamScheduleData(team: TeamRef, filter: RoundFilter) {
    return readByPolicy({
        kind: "TEAM_SCHEDULE",
        key: cacheKeys.teamSchedule(team, filter),
        load: () => getTeamSchedule({ ...team, filter })
    });
}

export function getTeamBalanceData(team: TeamRef, filter: RoundFilter) {
    return readByPolicy({
        kind: "TEAM_BALANCES",
        key: cacheKeys.teamBalances(team, filter),
        load: () => getTeamBalances({ ...team, filter }),
        // Bilanzen ändern sich nur nach Spielen: das Fenster kommt aus dem Mannschaftsspielplan.
        freshContext: () => ({
            matchWindow: matchWindowFromCachedSchedule<TeamScheduleResponse>(
                cacheKeys.teamSchedule(team, filter),
                teamScheduleDates
            )
        })
    });
}
