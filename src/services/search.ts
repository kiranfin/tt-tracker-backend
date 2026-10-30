import { cacheKeys } from "../cacheKeys.js";
import { searchClubs, searchPlayers } from "../mytt/search.js";
import type { ClubSearchResponse, PlayerSearchResponse } from "../schemas.js";
import { searchKnownClubs, searchKnownPlayers } from "../sources/knownSearch.js";
import { readByPolicy, type ResponseMeta, type ServiceResult } from "./read.js";

export type SearchParams = {
    query: string;
    page: number;
    pagesize: number;
};

// Antwort aus der Notfall Suche (nur bereits bekannte Spieler oder Vereine).
const KNOWN_RESULTS_META: ResponseMeta = {
    source: "stale",
    origin: "upstream",
    fetchedAt: null,
    fallback: "known_results"
};

/**
 * Spielersuche. Fällt myTischtennis aus, kommen bereits bekannte Spieler aus dem Cache. Gibt es auch
 * davon keine, wird der ursprüngliche Fehler geworfen. `onError` meldet ihn vorher (Logging der Route).
 */
export async function getPlayerSearch(
    params: SearchParams,
    onError?: (error: unknown) => void
): Promise<ServiceResult<PlayerSearchResponse>> {
    try {
        return await readByPolicy({
            kind: "PLAYER_SEARCH",
            key: cacheKeys.playerSearch(params.query, params.page, params.pagesize),
            load: () => searchPlayers(params)
        });
    } catch (error) {
        onError?.(error);

        const known = searchKnownPlayers(params);

        if (known.results.length > 0) {
            return { value: known, meta: KNOWN_RESULTS_META };
        }

        throw error;
    }
}

export async function getClubSearch(
    params: SearchParams,
    onError?: (error: unknown) => void
): Promise<ServiceResult<ClubSearchResponse>> {
    try {
        return await readByPolicy({
            kind: "CLUB_SEARCH",
            key: cacheKeys.clubSearch(params.query, params.page, params.pagesize),
            load: () => searchClubs(params)
        });
    } catch (error) {
        onError?.(error);

        const known = searchKnownClubs(params);

        if (known.results.length > 0) {
            return { value: known, meta: KNOWN_RESULTS_META };
        }

        throw error;
    }
}
