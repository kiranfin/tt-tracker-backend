import { cacheKeys } from "../cacheKeys.js";
import {
    getTeamBalances,
    getTeamInfos,
    getTeamPlayers,
    getTeamSchedule,
    getTeamSimpleSchedule
} from "../mytt/team.js";
import { readByPolicy } from "./read.js";

export type TeamRef = {
    association: string;
    season: string;
    groupId: string;
    leagueSlug: string;
    teamId: string;
    teamNameSlug: string;
};

type RoundFilter = "gesamt" | "vr" | "rr";

export function getTeamPlayerList(teamId: string) {
    return readByPolicy({
        kind: "TEAM_PLAYERS",
        key: cacheKeys.teamPlayers(teamId),
        load: () => getTeamPlayers({ teamId })
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
        load: () => getTeamBalances({ ...team, filter })
    });
}
