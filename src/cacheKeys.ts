type TeamKeyParts = {
    association: string;
    season: string;
    groupId: string;
    leagueSlug: string;
    teamId: string;
    teamNameSlug: string;
};

function teamKey(params: TeamKeyParts) {
    return [
        params.association,
        params.season,
        params.groupId,
        params.leagueSlug,
        params.teamId,
        params.teamNameSlug
    ].join(":");
}

/**
 * Alle Cache Keys an einer Stelle. Das Format ist stabil: der Cache wird auf die Platte gesichert,
 * ein geändertes Format verwirft die gesicherten Einträge. Ändert sich die Form der Daten, die
 * Version im Key hochziehen (siehe leagueRegions).
 */
export const cacheKeys = {
    playerSearch: (query: string, page: number, pagesize: number) =>
        `players:${query.toLowerCase()}:${page}:${pagesize}`,
    clubSearch: (query: string, page: number, pagesize: number) =>
        `clubs:${query.toLowerCase()}:${page}:${pagesize}`,

    playerTtr: (nuid: string) => `player-ttr:${nuid}`,
    playerTtrHistory: (nuid: string) => `player-ttr-history:${nuid}`,
    playerTtrEstimate: (nuid: string, organization: string, clubNumber: string, name?: string) =>
        `player-ttr-estimate:${nuid}:${organization}:${clubNumber}:${name ?? ""}`,
    // normalizedId: Spieler ID ohne NU Präfix.
    playerClub: (normalizedId: string) => `player-club:${normalizedId}`,

    clubHead: (organization: string, clubNumber: string) =>
        `club-head:${organization}:${clubNumber}`,
    // Der Slug ändert die Daten nicht, deshalb nicht im Key.
    clubInfo: (organization: string, clubNumber: string, season: string) =>
        `club-info:${organization}:${clubNumber}:${season}`,
    clubTeams: (organization: string, clubNumber: string) =>
        `club-teams:${organization}:${clubNumber}`,
    // Der Vereinsname gehört bewusst nicht in den Key (verschiedene Schreibweisen, ein Eintrag).
    clubPlayers: (organization: string, clubNumber: string, androClubNr?: string) =>
        [
            "club-players-andro",
            organization.trim().toUpperCase(),
            clubNumber.trim(),
            androClubNr?.trim() ?? ""
        ].join(":"),
    // Zweiter Eintrag, wenn die Andro Nummer nur über den Namen aufzulösen war.
    clubPlayersByName: (baseKey: string, clubName: string) =>
        `${baseKey}:${clubName.toLowerCase()}`,
    clubSchedule: (params: {
        organization: string;
        clubNumber: string;
        season: string;
        clubSlug: string;
        dateStart?: string;
        dateEnd?: string;
    }) =>
        [
            "club-schedule",
            params.organization,
            params.clubNumber,
            params.season,
            params.clubSlug,
            params.dateStart ?? "",
            params.dateEnd ?? ""
        ].join(":"),
    androClubNr: (organization: string, clubNumber: string) =>
        `andro-club-nr:${organization.toUpperCase()}:${clubNumber}`,

    // v2: ältere Einträge enthalten bei weiterleitenden Verbänden Gruppen statt Ebenen.
    leagueRegions: (association: string, season: string) =>
        `league-regions:v2:${association}:${season}`,
    leagueClasses: (
        association: string,
        season: string,
        competitionType: string,
        championship: string
    ) => `league-classes:${association}:${season}:${competitionType}:${championship}`,
    leagueTable: (
        association: string,
        season: string,
        groupId: string,
        leagueSlug: string,
        filter: string
    ) => `league-table:${association}:${season}:${groupId}:${leagueSlug}:${filter}`,
    leagueSchedule: (
        association: string,
        season: string,
        groupId: string,
        leagueSlug: string,
        filter: string
    ) => `league-schedule:${association}:${season}:${groupId}:${leagueSlug}:${filter}`,

    teamPlayers: (teamId: string) => `team-players:${teamId}`,
    teamSimpleSchedule: (teamId: string, season: string) =>
        `team-simple-schedule:${teamId}:${season}`,
    teamInfos: (params: TeamKeyParts) => `team-infos:${teamKey(params)}`,
    teamSchedule: (params: TeamKeyParts, filter: string) =>
        `team-schedule:${teamKey(params)}:${filter}`,
    teamBalances: (params: TeamKeyParts, filter: string) =>
        `team-balances:${teamKey(params)}:${filter}`,

    meetingLive: (meetingId: string) => `meeting-live:${meetingId}`,

    eventsList: () => "events:list",
    eventsDetail: (id: string) => `events:detail:${id.toLowerCase()}`
};

// Erstes Segment eines Keys zur Datenart (policies.ts). Gegenstück zu den Builder Funktionen oben.
const KIND_BY_PREFIX: Record<string, string> = {
    players: "PLAYER_SEARCH",
    clubs: "CLUB_SEARCH",
    "player-ttr": "PLAYER_TTR",
    "player-ttr-history": "PLAYER_TTR_HISTORY",
    "player-ttr-estimate": "PLAYER_TTR_ESTIMATE",
    "player-club": "PLAYER_CLUB",
    "club-head": "CLUB_HEAD",
    "club-info": "CLUB_INFO",
    "club-teams": "CLUB_TEAMS",
    "club-players-andro": "CLUB_PLAYERS",
    "club-schedule": "CLUB_SCHEDULE",
    "andro-club-nr": "ANDRO_CLUB_NR",
    "league-regions": "LEAGUE_REGIONS",
    "league-classes": "LEAGUE_CLASSES",
    "league-table": "LEAGUE_TABLE",
    "league-schedule": "LEAGUE_SCHEDULE",
    "team-players": "TEAM_PLAYERS",
    "team-simple-schedule": "TEAM_SIMPLE_SCHEDULE",
    "team-infos": "TEAM_INFOS",
    "team-schedule": "TEAM_SCHEDULE",
    "team-balances": "TEAM_BALANCES",
    "meeting-live": "MEETING"
};

/** Datenart eines Cache Keys, null für unbekannte Keys. */
export function kindOfKey(key: string): string | null {
    const [prefix, second] = key.split(":");

    if (prefix === "events") {
        return second === "list" ? "EVENTS_LIST" : second === "detail" ? "EVENTS_DETAIL" : null;
    }

    return KIND_BY_PREFIX[prefix!] ?? null;
}
