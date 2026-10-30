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
    clubScheduleDates,
    getMatchWindow,
    leagueScheduleDates,
    parseMeetingStart,
    teamScheduleDates,
    type MatchWindow
} from "./sources/scheduleDates.js";
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

/** Nie kürzer als das, auch wenn der nächste Termin gleich endet. */
const MIN_SCHEDULE_FRESH_MS = 5 * MINUTE;

/** Läuft gerade ein Termin, dann regelmäßig nachsehen, bis die Ergebnisse eingetragen sind. */
const LIVE_WINDOW_FRESH_MS = 10 * MINUTE;

export type Priority = "interactive" | "background";

/** Zusatzwissen beim Berechnen der Frische, das nicht im geladenen Wert steckt. */
export type FreshContext = {
    now?: number;
    // Terminfenster aus dem gecachten Spielplan (für Tabelle und Bilanzen, deren Daten keine Termine enthalten).
    matchWindow?: MatchWindow | null;
};

/**
 * Aktualisierung nach Spielplan: Die Daten ändern sich nur, wenn gespielt wird. Deshalb gilt der
 * Eintrag bis zum Ende des nächsten Spieltermins (Beginn plus 3 Stunden), höchstens `max`. Läuft
 * gerade ein Termin, wird alle 10 Minuten nachgesehen. Ohne Termine mehr in den Daten gilt `max`.
 */
export type ScheduleFreshness<T> = {
    max: number;
    // Termine aus dem Wert selbst. Fehlt es, kommt das Fenster aus FreshContext.matchWindow.
    dates?: (value: T) => unknown[];
};

/**
 * Wie lange eine Datenart gilt. Die einzige Stelle für TTLs: Services lesen sie hier, nie aus Routen.
 * - fresh: so lange kommt der Eintrag direkt aus dem Cache. Eine Funktion entscheidet nach dem Wert.
 *   Mit `schedule` ist es der Wert, solange kein Terminfenster bekannt ist.
 * - isEmpty + emptyFresh: ein leeres Ergebnis (Saison noch nicht begonnen) wird kürzer gehalten.
 * - staleMax: so lange taugt ein abgelaufener Eintrag als Notnagel, wenn myTT nicht antwortet,
 *   und für stale-while-revalidate.
 * - swr: abgelaufene Einträge sofort liefern und im Hintergrund aktualisieren. Aus bei Daten, die
 *   beim Warten auf den Abruf stimmen müssen (laufende Spiele).
 * - priority: Warteschlange Priorität des Loads. Nutzer gehen vor Hintergrundarbeit.
 */
export type Policy<T> = {
    fresh: number | ((value: T, now: number) => number);
    schedule?: ScheduleFreshness<T>;
    isEmpty?: (value: T) => boolean;
    emptyFresh?: number;
    staleMax: number;
    swr: boolean;
    priority: Priority;
};

function policy<T>(
    fresh: Policy<T>["fresh"],
    options: Partial<Omit<Policy<T>, "fresh">> = {}
): Policy<T> {
    const longestFresh = Math.max(
        typeof fresh === "number" ? fresh : 0,
        options.schedule?.max ?? 0
    );

    return {
        fresh,
        // Mindestens die globale Obergrenze, bei sehr lange gültigen Daten das Doppelte der Frische.
        staleMax: Math.max(config.cache.staleMaxAgeMs, 2 * longestFresh),
        swr: true,
        priority: "interactive",
        ...options
    };
}

function meetingFreshMs(value: MeetingLiveResponse, now: number) {
    const data = value.data;

    if (data?.live === true) {
        return MINUTE;
    }

    if (data?.is_completed === true) {
        return MEETING_COMPLETED_FRESH_MS;
    }

    // Geplant: bis zum Beginn. Mindestens 2 Minuten, höchstens ein Tag, falls der Termin verschoben wird.
    const start = parseMeetingStart(data?.scheduled);

    if (start !== null && start > now) {
        return Math.min(DAY, Math.max(2 * MINUTE, start - now));
    }

    return 2 * MINUTE;
}

export const DATA_POLICIES = {
    // Suche
    PLAYER_SEARCH: policy<unknown>(DAY),
    CLUB_SEARCH: policy<unknown>(DAY),

    // Spieler (die persönlichen TTR Pfade fallen mit Phase 4 weg)
    PLAYER_TTR: policy<unknown>(30 * MINUTE, { swr: false }),
    PLAYER_TTR_HISTORY: policy<unknown>(HOUR, { swr: false }),
    // Unvollständige Schätzung (pending): nur kurz cachen, der nächste Aufruf lädt die nächste Etappe.
    PLAYER_TTR_ESTIMATE: policy<{ coverage: { pending: number } }>(30 * MINUTE, {
        isEmpty: (estimate) => estimate.coverage.pending > 0,
        swr: false
    }),
    PLAYER_CLUB: policy<unknown>(12 * HOUR, { isEmpty: (club) => club === null }),

    // Vereine
    CLUB_TEAMS: policy<unknown>(HOUR),
    // Adressen, Spiellokale und Vorstand ändern sich selten.
    CLUB_INFO: policy<unknown>(12 * HOUR),
    // Vereinslogos (Layout Loader), ändern sich fast nie.
    CLUB_HEAD: policy<unknown>(30 * DAY),
    CLUB_SCHEDULE: policy<ClubScheduleResponse>(HOUR, {
        schedule: { max: 12 * HOUR, dates: clubScheduleDates },
        isEmpty: isEmptyClubSchedule
    }),
    CLUB_PLAYERS: policy<ClubPlayersResponse>(HOUR, {
        isEmpty: (list) => list.data.length === 0
    }),
    // Aufgelöste Andro Vereinsnummer (click-TT Nummer zu Andro Nummer).
    ANDRO_CLUB_NR: policy<string>(30 * DAY),

    // Ligen
    LEAGUE_REGIONS: policy<{ regions: unknown[] }>(7 * DAY, {
        isEmpty: (value) => value.regions.length === 0
    }),
    LEAGUE_CLASSES: policy<{ classes: unknown[] }>(7 * DAY, {
        isEmpty: (value) => value.classes.length === 0
    }),
    // Die Tabelle enthält keine Termine, das Fenster kommt aus dem gecachten Liga Spielplan.
    LEAGUE_TABLE: policy<LeagueTableResponse>(15 * MINUTE, {
        schedule: { max: DAY },
        isEmpty: isEmptyLeagueTable
    }),
    LEAGUE_SCHEDULE: policy<LeagueScheduleResponse>(HOUR, {
        schedule: { max: DAY, dates: leagueScheduleDates },
        isEmpty: isEmptyLeagueSchedule
    }),

    // Mannschaften
    TEAM_PLAYERS: policy<unknown>(10 * MINUTE),
    TEAM_SIMPLE_SCHEDULE: policy<unknown>(5 * MINUTE),
    TEAM_INFOS: policy<unknown>(15 * MINUTE),
    TEAM_SCHEDULE: policy<TeamScheduleResponse>(5 * MINUTE, {
        schedule: { max: DAY, dates: teamScheduleDates },
        isEmpty: isEmptyTeamSchedule
    }),
    // Bilanzen: das Fenster kommt aus dem gecachten Mannschaftsspielplan.
    TEAM_BALANCES: policy<TeamBalancesResponse>(5 * MINUTE, {
        schedule: { max: DAY },
        isEmpty: isEmptyTeamBalances
    }),

    // Spielberichte: live, geplant und abgeschlossen haben verschiedene Laufzeiten.
    MEETING: policy<MeetingLiveResponse>(meetingFreshMs, { swr: false }),

    // Veranstaltungen
    EVENTS_LIST: policy<unknown>(30 * MINUTE),
    EVENTS_DETAIL: policy<unknown>(HOUR)
} satisfies Record<string, Policy<any>>;

export type DataKind = keyof typeof DATA_POLICIES;

function scheduleFreshMs<T>(schedule: ScheduleFreshness<T>, window: MatchWindow, now: number) {
    if (window.activeNow) {
        return LIVE_WINDOW_FRESH_MS;
    }

    if (window.nextEnd === null) {
        return schedule.max;
    }

    return Math.min(schedule.max, Math.max(MIN_SCHEDULE_FRESH_MS, window.nextEnd - now));
}

/** Frische Dauer für einen geladenen Wert, leere Ergebnisse gekürzt. */
export function getFreshMs<T>(kind: DataKind, value: T, context: FreshContext = {}): number {
    const entry = DATA_POLICIES[kind] as Policy<T>;
    const now = context.now ?? Date.now();
    let fresh = typeof entry.fresh === "function" ? entry.fresh(value, now) : entry.fresh;

    if (entry.schedule) {
        const window = entry.schedule.dates
            ? getMatchWindow(entry.schedule.dates(value), now)
            : context.matchWindow;

        if (window) {
            fresh = scheduleFreshMs(entry.schedule, window, now);
        }
    }

    if (entry.isEmpty?.(value)) {
        return Math.min(fresh, entry.emptyFresh ?? EMPTY_RESULT_FRESH_MS);
    }

    return fresh;
}
