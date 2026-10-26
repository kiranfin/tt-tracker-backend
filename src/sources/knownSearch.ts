import { getCachedValues } from "../cache/index.js";
import type { ClubSearchItem, ClubSearchResponse, PlayerSearchItem, PlayerSearchResponse } from "../schemas.js";

// Notfall Suche, wenn die Suche von myTischtennis ausfällt: durchsucht alle Spieler und Vereine,
// die das Backend schon kennt (frühere Suchen, Vereinsspieler, Mannschaftsaufstellungen).
// Findet nur Bekanntes, ist aber besser als gar nichts.

const MAX_DEPTH = 8;

function normalize(value: string) {
    return value
        .toLowerCase()
        .replaceAll("ä", "ae")
        .replaceAll("ö", "oe")
        .replaceAll("ü", "ue")
        .replaceAll("ß", "ss")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
}

function matchesQuery(text: string, query: string) {
    const haystack = normalize(text);
    const tokens = normalize(query).split(" ").filter(Boolean);

    return tokens.length > 0 && tokens.every((token) => haystack.includes(token));
}

function visitRecords(value: unknown, visit: (record: Record<string, unknown>) => void, depth = 0) {
    if (depth > MAX_DEPTH || !value || typeof value !== "object") {
        return;
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            visitRecords(item, visit, depth + 1);
        }

        return;
    }

    const record = value as Record<string, unknown>;

    visit(record);

    for (const child of Object.values(record)) {
        visitRecords(child, visit, depth + 1);
    }
}

function asText(value: unknown) {
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function toPlayerItem(record: Record<string, unknown>): PlayerSearchItem | null {
    const internalId = asText(record.internal_id);
    const firstname = asText(record.firstname);
    const lastname = asText(record.lastname);

    if (!internalId || !/^NU\d+$/i.test(internalId) || (!firstname && !lastname)) {
        return null;
    }

    return {
        firstname,
        lastname,
        internal_id: internalId.toUpperCase(),
        person_id: typeof record.person_id === "number" ? record.person_id : null,
        licence_club: asText(record.licence_club),
        dttb_player_id: asText(record.dttb_player_id),
        club_name: asText(record.club_name) ?? asText(record.clubname)
    };
}

function toClubItem(record: Record<string, unknown>): ClubSearchItem | null {
    if (!asText(record.clubnr) || !asText(record.clubname)) {
        return null;
    }

    return record as ClubSearchItem;
}

function paginate<T>(items: T[], page: number, pagesize: number) {
    return {
        results: items.slice((page - 1) * pagesize, page * pagesize),
        total_count: items.length,
        pages_count: Math.ceil(items.length / pagesize),
        page,
        pagesize
    };
}

export function searchKnownPlayers(params: {
    query: string;
    page: number;
    pagesize: number;
}): PlayerSearchResponse {
    const byId = new Map<string, PlayerSearchItem>();

    for (const value of getCachedValues()) {
        visitRecords(value, (record) => {
            const player = toPlayerItem(record);

            if (!player?.internal_id) {
                return;
            }

            const name = `${player.firstname ?? ""} ${player.lastname ?? ""}`;
            const known = byId.get(player.internal_id);

            // Einträge mit Vereinsnamen (aus der echten Suche) bevorzugen.
            if (matchesQuery(name, params.query) && (!known || (!known.club_name && player.club_name))) {
                byId.set(player.internal_id, player);
            }
        });
    }

    const players = [...byId.values()].sort((a, b) =>
        `${a.lastname ?? ""} ${a.firstname ?? ""}`.localeCompare(
            `${b.lastname ?? ""} ${b.firstname ?? ""}`,
            "de"
        )
    );

    return paginate(players, params.page, params.pagesize);
}

export function searchKnownClubs(params: {
    query: string;
    page: number;
    pagesize: number;
}): ClubSearchResponse {
    const byKey = new Map<string, ClubSearchItem>();

    for (const value of getCachedValues()) {
        visitRecords(value, (record) => {
            const club = toClubItem(record);

            if (club && matchesQuery(String(club.clubname), params.query)) {
                byKey.set(`${club.organization_id ?? ""}:${club.clubnr}`, club);
            }
        });
    }

    const clubs = [...byKey.values()].sort((a, b) =>
        String(a.clubname).localeCompare(String(b.clubname), "de")
    );

    return paginate(clubs, params.page, params.pagesize);
}
