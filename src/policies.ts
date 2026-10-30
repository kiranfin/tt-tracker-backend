import { config } from "./config.js";
import type {
    ClubPlayersResponse,
    ClubScheduleResponse,
    LeagueScheduleResponse,
    LeagueTableResponse,
    MeetingLiveResponse,
    TeamBalancesResponse,
    TeamScheduleResponse
} from "./schemas.js";
import {
    isEmptyClubSchedule,
    isEmptyLeagueSchedule,
    isEmptyLeagueTable,
    isEmptyTeamBalances,
    isEmptyTeamSchedule
} from "./sources/validate.js";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Leere Tabellen und Spielpläne (Saison noch nicht begonnen oder Format verschoben) schnell neu prüfen. */
export const EMPTY_RESULT_FRESH_MS = 2 * MINUTE;

/** Abgeschlossene Spielberichte ändern sich nicht mehr, sie liegen zusätzlich dauerhaft im Store. */
export const MEETING_COMPLETED_FRESH_MS = 7 * DAY;

export type Priority = "interactive" | "background";

/**
 * Wie lange eine Datenart gilt. Die einzige Stelle für TTLs: Services lesen sie hier, nie aus Routen.
 * - fresh: so lange kommt der Eintrag direkt aus dem Cache. Eine Funktion entscheidet nach dem Wert.
 * - isEmpty + emptyFresh: ein leeres Ergebnis (Saison noch nicht begonnen) wird kürzer gehalten.
 * - staleMax: so alt darf ein abgelaufener Eintrag als Notnagel bleiben, wenn myTT nicht antwortet.
 * - priority: Warteschlange Priorität des Loads. Nutzer gehen vor Hintergrundarbeit.
 */
export type Policy<T> = {
    fresh: number | ((value: T) => number);
    isEmpty?: (value: T) => boolean;
    emptyFresh?: number;
    staleMax: number;
    priority: Priority;
};

function policy<T>(
    fresh: Policy<T>["fresh"],
    options: Partial<Omit<Policy<T>, "fresh">> = {}
): Policy<T> {
    return {
        fresh,
        staleMax: config.cache.staleMaxAgeMs,
        priority: "interactive",
        ...options
    };
}

function meetingFreshMs(value: MeetingLiveResponse) {
    if (value.data?.live === true) {
        return 30 * SECOND;
    }

    return value.data?.is_completed === true ? MEETING_COMPLETED_FRESH_MS : 2 * MINUTE;
}

export const DATA_POLICIES = {
    // Suche
    PLAYER_SEARCH: policy<unknown>(5 * MINUTE),
    CLUB_SEARCH: policy<unknown>(15 * MINUTE),

    // Spieler
    PLAYER_TTR: policy<unknown>(30 * MINUTE),
    PLAYER_TTR_HISTORY: policy<unknown>(HOUR),
    // Unvollständige Schätzung (pending): nur kurz cachen, der nächste Aufruf lädt die nächste Etappe.
    PLAYER_TTR_ESTIMATE: policy<{ coverage: { pending: number } }>(30 * MINUTE, {
        isEmpty: (estimate) => estimate.coverage.pending > 0
    }),
    PLAYER_CLUB: policy<unknown>(12 * HOUR, { isEmpty: (club) => club === null }),

    // Vereine
    CLUB_TEAMS: policy<unknown>(HOUR),
    // Adressen, Spiellokale und Vorstand ändern sich selten.
    CLUB_INFO: policy<unknown>(12 * HOUR),
    // Vereinslogos (Layout Loader), ändern sich fast nie.
    CLUB_HEAD: policy<unknown>(7 * DAY),
    CLUB_SCHEDULE: policy<ClubScheduleResponse>(HOUR, { isEmpty: isEmptyClubSchedule }),
    CLUB_PLAYERS: policy<ClubPlayersResponse>(HOUR, {
        isEmpty: (list) => list.data.length === 0
    }),
    // Aufgelöste Andro Vereinsnummer (click-TT Nummer zu Andro Nummer).
    ANDRO_CLUB_NR: policy<string>(DAY),

    // Ligen
    LEAGUE_REGIONS: policy<{ regions: unknown[] }>(6 * HOUR, {
        isEmpty: (value) => value.regions.length === 0
    }),
    LEAGUE_CLASSES: policy<{ classes: unknown[] }>(HOUR, {
        isEmpty: (value) => value.classes.length === 0
    }),
    LEAGUE_TABLE: policy<LeagueTableResponse>(15 * MINUTE, { isEmpty: isEmptyLeagueTable }),
    LEAGUE_SCHEDULE: policy<LeagueScheduleResponse>(HOUR, { isEmpty: isEmptyLeagueSchedule }),

    // Mannschaften
    TEAM_PLAYERS: policy<unknown>(10 * MINUTE),
    TEAM_SIMPLE_SCHEDULE: policy<unknown>(5 * MINUTE),
    TEAM_INFOS: policy<unknown>(15 * MINUTE),
    TEAM_SCHEDULE: policy<TeamScheduleResponse>(5 * MINUTE, { isEmpty: isEmptyTeamSchedule }),
    TEAM_BALANCES: policy<TeamBalancesResponse>(5 * MINUTE, { isEmpty: isEmptyTeamBalances }),

    // Spielberichte: live, geplant und abgeschlossen haben verschiedene Laufzeiten.
    MEETING: policy<MeetingLiveResponse>(meetingFreshMs),

    // Veranstaltungen
    EVENTS_LIST: policy<unknown>(30 * MINUTE),
    EVENTS_DETAIL: policy<unknown>(HOUR)
} satisfies Record<string, Policy<any>>;

export type DataKind = keyof typeof DATA_POLICIES;

/** Frische Dauer für einen geladenen Wert, leere Ergebnisse gekürzt. */
export function getFreshMs<T>(kind: DataKind, value: T): number {
    const entry = DATA_POLICIES[kind] as Policy<T>;
    const fresh = typeof entry.fresh === "function" ? entry.fresh(value) : entry.fresh;

    if (entry.isEmpty?.(value)) {
        return Math.min(fresh, entry.emptyFresh ?? EMPTY_RESULT_FRESH_MS);
    }

    return fresh;
}
