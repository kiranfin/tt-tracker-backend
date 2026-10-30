import { readThrough } from "../cache/index.js";
import { CACHE_TTL } from "../constants.js";
import type { ClubPlayer } from "../schemas.js";
import { readClubPlayers } from "./clubPlayersCache.js";
import { findPlayerInClubList, normalizePlayerId } from "./rating.js";
import { searchClubs, searchPlayers } from "./search.js";

export type PlayerClub = {
    organization: string;
    clubNumber: string;
    clubName: string;
};

export type PublicPlayerHit = {
    club: PlayerClub;
    player: ClubPlayer;
    fetchedAt: string;
    source: Awaited<ReturnType<typeof readClubPlayers>>["source"];
    origin: Awaited<ReturnType<typeof readClubPlayers>>["origin"];
};

const PLAYER_CLUB_TTL_MS = 12 * 60 * 60 * 1000;

/** "TTV Erdmannhausen (2055015)" ergibt Name und Vereinsnummer. */
function parseLicenceClub(value: string | null | undefined) {
    const match = /^(.*?)\s*\((\d+)\)\s*$/.exec(value?.trim() ?? "");

    return match ? { name: match[1]!.trim(), clubNumber: match[2]! } : null;
}

async function loadPlayerClub(nuid: string, name: string): Promise<PlayerClub | null> {
    const wanted = normalizePlayerId(nuid);

    const players = await searchPlayers({ query: name, page: 1, pagesize: 20 });

    const found = players.results.find(
        (player) => normalizePlayerId(player.internal_id) === wanted
    );

    const licence = parseLicenceClub(found?.licence_club);

    if (!found || !licence) {
        return null;
    }

    const clubName = found.club_name?.trim() || licence.name;

    // Die Spielersuche kennt nur die Vereinsnummer, der Verband steht in der Vereinssuche.
    const clubs = await searchClubs({ query: clubName, page: 1, pagesize: 10 });

    const club =
        clubs.results.find(
            (candidate) =>
                candidate.clubnr === licence.clubNumber &&
                candidate.clubname?.trim() === clubName
        ) ?? clubs.results.find((candidate) => candidate.clubnr === licence.clubNumber);

    if (!club?.organization_short) {
        return null;
    }

    return {
        organization: club.organization_short.toUpperCase(),
        clubNumber: licence.clubNumber,
        clubName
    };
}

/** Verein eines Spielers über die öffentliche Spieler- und Vereinssuche, pro Spieler gecacht. */
export async function resolvePlayerClub(params: { nuid: string; name: string }) {
    const result = await readThrough({
        key: `player-club:${normalizePlayerId(params.nuid)}`,
        ttlMs: (club: PlayerClub | null) =>
            club === null ? CACHE_TTL.EMPTY_RESULT : PLAYER_CLUB_TTL_MS,
        load: () => loadPlayerClub(params.nuid, params.name)
    });

    return result.value;
}

/**
 * Spieler samt Vereinsliste finden. Erst im angegebenen Verein, sonst über den Namen im Verein laut Suche
 * (z.B. wenn das Profil nur mit NUID und Namen geöffnet wurde oder der Spieler den Verein gewechselt hat).
 */
export async function lookupPublicPlayer(params: {
    nuid: string;
    name?: string;
    organization?: string;
    clubNumber?: string;
    clubName?: string;
}): Promise<PublicPlayerHit | null> {
    const tried = new Set<string>();

    async function tryClub(club: { organization: string; clubNumber: string; clubName?: string }) {
        const key = `${club.organization}:${club.clubNumber}`;

        if (tried.has(key)) {
            return null;
        }

        tried.add(key);

        const list = await readClubPlayers(club);
        const player = findPlayerInClubList(list.value.data, params.nuid);

        if (!player) {
            return null;
        }

        return {
            club: {
                organization: club.organization,
                clubNumber: club.clubNumber,
                clubName: club.clubName ?? player.club_name ?? ""
            },
            player,
            fetchedAt: list.fetchedAt,
            source: list.source,
            origin: list.origin
        } satisfies PublicPlayerHit;
    }

    if (params.organization && params.clubNumber) {
        const hit = await tryClub({
            organization: params.organization,
            clubNumber: params.clubNumber,
            clubName: params.clubName
        });

        if (hit) {
            return hit;
        }
    }

    const name = params.name?.trim();

    if (!name) {
        return null;
    }

    const club = await resolvePlayerClub({ nuid: params.nuid, name });

    return club ? tryClub(club) : null;
}
