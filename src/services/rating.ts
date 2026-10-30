import { cacheKeys } from "../cacheKeys.js";
import { findPlayerInClubList, normalizePlayerId, toPublicRating } from "../mytt/rating.js";
import { searchClubs, searchPlayers } from "../mytt/search.js";
import type { ClubPlayer } from "../schemas.js";
import { getClubPlayerList } from "./club.js";
import { readByPolicy, type ResponseMeta } from "./read.js";

export type PlayerClub = {
    organization: string;
    clubNumber: string;
    clubName: string;
};

export type PublicPlayerHit = {
    club: PlayerClub;
    player: ClubPlayer;
    // Herkunft und Alter der Vereinsliste, aus der der Spieler stammt.
    meta: ResponseMeta;
};

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
    const result = await readByPolicy<PlayerClub | null>({
        kind: "PLAYER_CLUB",
        key: cacheKeys.playerClub(normalizePlayerId(params.nuid)),
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

        const list = await getClubPlayerList(club);
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
            meta: list.meta
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

/** Öffentlicher TTR aus der Andro Rangliste des Vereins, ohne myTischtennis Login. */
export async function getPublicPlayerRating(params: {
    nuid: string;
    name: string;
    organization: string;
    clubNumber: string;
    clubName?: string;
}) {
    const hit = await lookupPublicPlayer(params);
    const rating = hit ? toPublicRating(hit.player, String(hit.meta.fetchedAt)) : null;

    return {
        value: {
            nuid: params.nuid,
            available: rating !== null,
            rating,
            club: hit?.club ?? null
        },
        meta: hit ? hit.meta : ({ source: "upstream" } satisfies ResponseMeta)
    };
}
