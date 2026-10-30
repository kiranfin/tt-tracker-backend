import { readThrough } from "../cache/index.js";
import { CACHE_TTL } from "../constants.js";
import { ttlUnlessEmpty } from "../sources/validate.js";
import { getClubPlayersFromAndroRanking } from "./androRanking.js";

const CLUB_PLAYERS_CACHE_TTL =
    (CACHE_TTL as Record<string, number>).CLUB_PLAYERS ?? CACHE_TTL.CLUB_TEAMS;

/**
 * Vereinsliste aus der Andro Rangliste über den Cache. Eine Stelle für den Cache Key,
 * damit die Vereinsroute und die Rating Route denselben Eintrag nutzen.
 *
 * Der Vereinsname gehört nicht in den Key: er kommt je nach Aufrufer aus dem Spielbericht, aus der
 * App oder aus der Spielersuche und ist nicht immer gleich geschrieben. Mit Namen im Key bekäme
 * derselbe Verein mehrere Einträge unterschiedlichen Alters, und zwei Ansichten zeigten
 * verschiedene Werte.
 */
export async function readClubPlayers(params: {
    organization: string;
    clubNumber: string;
    androClubNr?: string;
    clubName?: string;
}) {
    const baseKey = [
        "club-players-andro",
        params.organization.trim().toUpperCase(),
        params.clubNumber.trim(),
        params.androClubNr?.trim() ?? ""
    ].join(":");

    const read = (key: string) =>
        readThrough({
            key,
            ttlMs: ttlUnlessEmpty(CLUB_PLAYERS_CACHE_TTL, (list) => list.data.length === 0),
            load: () => getClubPlayersFromAndroRanking(params)
        });

    const result = await read(baseKey);

    // Ohne Namen lässt sich die Andro Vereinsnummer beim ersten Abruf manchmal nicht auflösen. Eine
    // leere Liste von so einem Aufruf soll nicht die Aufrufer blockieren, die den Namen mitbringen.
    const clubName = params.clubName?.trim();

    if (result.value.data.length === 0 && clubName && !params.androClubNr?.trim()) {
        return read(`${baseKey}:${clubName.toLowerCase()}`);
    }

    return result;
}
