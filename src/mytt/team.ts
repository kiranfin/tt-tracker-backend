import {
    TeamBalancesResponseSchema,
    TeamInfoResponseSchema,
    TeamPlayersResponseSchema,
    TeamScheduleResponseSchema,
    TeamSimpleScheduleResponseSchema
} from "../schemas.js";
import type {
    ClubTeamsResponse,
    TeamBalancesResponse,
    TeamInfoResponse,
    TeamPlayersResponse,
    TeamScheduleResponse,
    TeamSimpleScheduleResponse
} from "../schemas.js";
import { fetchWithFallback } from "../sources/fetchWithFallback.js";
import { teamLineupToApiResponse } from "../sources/html/clubTeams.js";
import { getRouteDataFromPage } from "../sources/html/pageRoute.js";
import { RemixContextParseError, type JsonRecord } from "../sources/html/remixContext.js";
import { validateTeamSchedule } from "../sources/validate.js";
import { RelayRequiredError } from "../upstream/errors.js";
import { parseUpstream } from "../upstream/parse.js";
import { getCurrentSeasonSegment } from "../utils/season.js";
import { buildClubLineupPath, CLUB_LINEUP_ROUTE_ID, getClubTeamsFromPage } from "./club.js";
import { toLeagueSlug } from "./league.js";
import { getJsonFromMytt, getRouteDataWithHtmlFallback } from "./request.js";

type TeamRoundFilter = "gesamt" | "vr" | "rr";

const TEAM_ROUTE_PREFIX =
    "routes/click-tt+/$association+/$season+/$type+/($groupname).gruppe.$urlid_.mannschaft.$teamid.$teamname+";

export const TEAM_INFOS_ROUTE_ID = `${TEAM_ROUTE_PREFIX}/infos`;
export const TEAM_SCHEDULE_ROUTE_ID = `${TEAM_ROUTE_PREFIX}/spielplan.$filter`;
export const TEAM_BALANCES_ROUTE_ID = `${TEAM_ROUTE_PREFIX}/spielerbilanzen.$filter`;

export function buildTeamContextPath(params: {
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

/**
 * Teaminfo Seite nur aus der Team ID. Wie beim Spielbericht wertet der Loader Verband, Saison, Liga, Gruppe und
 * Namen nicht aus (geprüft mit lauter Platzhaltern), er liefert trotzdem Verein und Verband der Mannschaft.
 */
export function buildTeamInfosPagePath(teamId: string): string {
    return `/click-tt/x/x/ligen/x/gruppe/x/mannschaft/${encodeURIComponent(teamId)}/x/infos`;
}

function readTeamClub(routeData: Record<string, unknown>) {
    const data = routeData.data as { club_id?: unknown; organisation_short?: unknown } | null | undefined;
    const clubNumber = typeof data?.club_id === "string" ? data.club_id.trim() : "";
    const organization = typeof data?.organisation_short === "string" ? data.organisation_short.trim() : "";

    if (!clubNumber || !organization) {
        throw new RemixContextParseError("Teaminfo loader data has no club_id or organisation_short.");
    }

    return { clubNumber, organization: organization.toUpperCase() };
}

type LineupHalf = "vr" | "rr";

// Halbserie der Meldung: ab Januar gilt die Rückrunde, vorher die Vorrunde.
function lineupHalves(now = new Date()): LineupHalf[] {
    return now.getMonth() < 6 ? ["rr", "vr"] : ["vr"];
}

/** Eine Mannschaftsmeldung. Sie gilt für alle Mannschaften eines Wettbewerbs im Verein. */
export type ClubLineupRef = {
    organization: string;
    clubNumber: string;
    season: string;
    contestType: string;
    half: LineupHalf;
};

/**
 * Ablage des Aufrufers für Zwischenergebnisse des HTML Fallbacks. Vereinsliste und Meldung gelten für alle
 * Mannschaften eines Vereins, ohne Ablage holt jede Mannschaft beide Seiten neu.
 */
export type TeamPagesStore = {
    getClubTeams: (organization: string, clubNumber: string) => ClubTeamsResponse | undefined;
    putClubTeams: (organization: string, clubNumber: string, teams: ClubTeamsResponse) => void;
    getLineup: (ref: ClubLineupRef) => JsonRecord | undefined;
    putLineup: (ref: ClubLineupRef, routeData: JsonRecord) => void;
};

const NO_STORE: TeamPagesStore = {
    getClubTeams: () => undefined,
    putClubTeams: () => {},
    getLineup: () => undefined,
    putLineup: () => {}
};

function isRejected<T>(entry: PromiseSettledResult<T>): entry is PromiseRejectedResult {
    return entry.status === "rejected";
}

/** Meldung aus der Ablage, sonst von der Seite. Abgelegt wird nur, was sich lesen ließ. */
async function loadLineup(ref: ClubLineupRef, teamNumber: number, store: TeamPagesStore) {
    const cached = store.getLineup(ref);

    if (cached) {
        return teamLineupToApiResponse(cached, teamNumber);
    }

    const { routeData } = await getRouteDataFromPage({
        path: buildClubLineupPath({
            association: ref.organization,
            season: ref.season,
            clubNumber: ref.clubNumber,
            contestType: ref.contestType,
            half: ref.half
        }),
        routeId: CLUB_LINEUP_ROUTE_ID
    });

    const lineup = teamLineupToApiResponse(routeData, teamNumber);

    store.putLineup(ref, routeData);

    return lineup;
}

/**
 * Aufstellung von den Webseiten, wenn `/api/ttr/team/players` gestört ist. Die Meldung hängt am Verein, die
 * Route kennt aber nur die Team ID. Deshalb:
 *
 * 1. Teaminfo Seite (nur Team ID) für Verein und Verband
 * 2. Mannschaften des Vereins (aus der Ablage, sonst die Vereinsseite) für Nummer und Wettbewerb der Mannschaft
 * 3. Mannschaftsmeldung des Wettbewerbs (aus der Ablage, sonst die Seite), gefiltert auf die Mannschaft
 *
 * Schritt 2 nimmt bewusst nicht die API: die ist ja gerade gestört, und über das Device Relay kostet jeder
 * Abruf, der auf einem anderen aufbaut, eine Runde (die App macht höchstens vier). So bleibt es bei vier:
 * API, Teaminfo, Vereinsseite, Meldung. In der Rückrunde laden Vor- und Rückrunde parallel in derselben Runde,
 * weil die Rückrunden Meldung bis zur Freigabe leer ist. Das kostet nur auf diesem Störungsweg einen Abruf mehr.
 * Vereinsliste und Meldung landen in der Ablage, weitere Mannschaften desselben Vereins brauchen dann nur noch
 * API und Teaminfo.
 */
async function getTeamPlayersFromPages(teamId: string, store: TeamPagesStore): Promise<TeamPlayersResponse> {
    const { routeData: infos } = await getRouteDataFromPage({
        path: buildTeamInfosPagePath(teamId),
        routeId: TEAM_INFOS_ROUTE_ID
    });

    const club = readTeamClub(infos);

    // Nummer und Wettbewerb stehen nur in Listen von der Vereinsseite, nicht in denen von der API.
    const findTeam = (teams: ClubTeamsResponse | undefined) => {
        const team = teams?.data.find((entry) => String(entry.team_id ?? "") === teamId);
        const teamNumber = Number(team?.team_nr);
        const contestType = team?.contest_type?.trim();

        return Number.isInteger(teamNumber) && contestType ? { teamNumber, contestType } : null;
    };

    const loadClubTeams = async () => {
        const teams = await getClubTeamsFromPage(club);

        store.putClubTeams(club.organization, club.clubNumber, teams);

        return teams;
    };

    // Eine abgelegte Liste kann älter sein (Saisonwechsel): fehlt die Mannschaft darin, die Vereinsseite holen.
    const team =
        findTeam(store.getClubTeams(club.organization, club.clubNumber)) ?? findTeam(await loadClubTeams());

    if (!team) {
        throw new RemixContextParseError(`Team ${teamId} not found in the club's team list.`);
    }

    const { teamNumber, contestType } = team;
    const season = getCurrentSeasonSegment();

    // allSettled statt all: mit Relay müssen alle Misses gemeldet sein, bevor die Antwort an die App geht.
    const settled = await Promise.allSettled(
        lineupHalves().map((half) =>
            loadLineup({ ...club, season, contestType, half }, teamNumber, store)
        )
    );

    return parseUpstream(TeamPlayersResponseSchema, pickLineup(settled), "team_players:html");
}

/**
 * Wählt aus den Meldungen der Halbserien (in der Reihenfolge von lineupHalves) die passende:
 *
 * - Ein Relay Miss geht vor, damit die App alle fehlenden Seiten in einer Runde holt.
 * - Sonst die erste Halbserie mit Spielern. Scheitert die Rückrunde, hat die Vorrunde aber Spieler, ist deren
 *   Meldung besser als ein Fehler.
 * - Keine mit Spielern und eine gescheitert: deren Fehler, denn die leere Liste könnte falsch sein.
 * - Alle leer (Meldung noch nicht freigegeben): die leere Liste.
 */
export function pickLineup<T extends { data: unknown[] }>(settled: PromiseSettledResult<T>[]): T {
    const relayMiss = settled.find(
        (entry): entry is PromiseRejectedResult => isRejected(entry) && entry.reason instanceof RelayRequiredError
    );

    if (relayMiss) {
        throw relayMiss.reason;
    }

    const lineups = settled.flatMap((entry) => (entry.status === "fulfilled" ? [entry.value] : []));
    const filled = lineups.find((entry) => entry.data.length > 0);
    const failed = settled.find(isRejected);

    if (filled) {
        return filled;
    }

    if (failed || lineups.length === 0) {
        throw failed?.reason ?? new RemixContextParseError("No lineup half was loaded.");
    }

    return lineups[lineups.length - 1]!;
}

export async function getTeamPlayers(
    params: { teamId: string },
    // Ablage für Vereinsliste und Meldung (Cache des Aufrufers), spart im Fallback Abrufe.
    store: Partial<TeamPagesStore> = {}
): Promise<TeamPlayersResponse> {
    const searchParams = new URLSearchParams({
        teamId: params.teamId
    });

    return fetchWithFallback({
        name: "team_players",
        primary: () =>
            getJsonFromMytt({
                name: "team_players",
                path: "/api/ttr/team/players",
                searchParams,
                schema: TeamPlayersResponseSchema
            }),
        fallback: () => getTeamPlayersFromPages(params.teamId, { ...NO_STORE, ...store })
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
    const searchParams = new URLSearchParams({ _data: TEAM_INFOS_ROUTE_ID });

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

    const searchParams = new URLSearchParams({ _data: TEAM_SCHEDULE_ROUTE_ID });

    return getRouteDataWithHtmlFallback({
        name: "team_schedule",
        path: buildTeamContextPath({
            ...params,
            page: "spielplan",
            filter
        }),
        searchParams,
        schema: TeamScheduleResponseSchema,
        validate: validateTeamSchedule
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

    const searchParams = new URLSearchParams({ _data: TEAM_BALANCES_ROUTE_ID });

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
