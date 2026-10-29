import { readThrough } from "../cache/index.js";
import { CACHE_TTL } from "../constants.js";
import { getClubPlayersFromAndroRanking } from "./androRanking.js";

const CLUB_PLAYERS_CACHE_TTL =
    (CACHE_TTL as Record<string, number>).CLUB_PLAYERS ?? CACHE_TTL.CLUB_TEAMS;

/**
 * Vereinsliste aus der Andro Rangliste über den Cache. Eine Stelle für den Cache Key,
 * damit die Vereinsroute und die Rating Route denselben Eintrag nutzen.
 */
export function readClubPlayers(params: {
    organization: string;
    clubNumber: string;
    androClubNr?: string;
    clubName?: string;
}) {
    const key = [
        "club-players-andro",
        params.organization,
        params.clubNumber,
        params.androClubNr ?? "",
        params.clubName ?? ""
    ].join(":");

    return readThrough({
        key,
        ttlMs: CLUB_PLAYERS_CACHE_TTL,
        load: () => getClubPlayersFromAndroRanking(params)
    });
}
