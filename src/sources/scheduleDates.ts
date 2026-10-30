import type {
    ClubScheduleResponse,
    LeagueScheduleResponse,
    TeamScheduleResponse
} from "../schemas.js";
import { flattenDateGroups } from "./validate.js";

/** Ein Spieltermin gilt ab Beginn für diese Dauer als laufend, danach sind Ergebnisse eingetragen. */
export const MEETING_WINDOW_MS = 3 * 60 * 60 * 1000;

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Beginn eines Termins. Ein Datum ohne Uhrzeit zählt bis zum Ende des Tages. */
export function parseMeetingStart(value: unknown): number | null {
    if (typeof value !== "string" || value.trim() === "") {
        return null;
    }

    const parsed = Date.parse(value);

    if (!Number.isFinite(parsed)) {
        return null;
    }

    return DATE_ONLY.test(value.trim()) ? parsed + DAY_MS - MEETING_WINDOW_MS : parsed;
}

export type MatchWindow = {
    // Läuft gerade ein Termin (Beginn bis Beginn plus Fenster)?
    activeNow: boolean;
    // Ende des nächsten oder laufenden Termins, null wenn keiner mehr ansteht.
    nextEnd: number | null;
};

export function getMatchWindow(dates: unknown[], now: number): MatchWindow {
    let nextEnd: number | null = null;
    let activeNow = false;

    for (const date of dates) {
        const start = parseMeetingStart(date);

        if (start === null) {
            continue;
        }

        const end = start + MEETING_WINDOW_MS;

        if (end <= now) {
            continue;
        }

        if (start <= now) {
            activeNow = true;
        }

        if (nextEnd === null || end < nextEnd) {
            nextEnd = end;
        }
    }

    return { activeNow, nextEnd };
}

function datesOf(meetings: unknown[]) {
    return meetings.map((meeting) =>
        typeof meeting === "object" && meeting !== null
            ? (meeting as Record<string, unknown>).date
            : undefined
    );
}

export function leagueScheduleDates(value: LeagueScheduleResponse) {
    return datesOf(flattenDateGroups(value.data?.meetings));
}

export function teamScheduleDates(value: TeamScheduleResponse) {
    return datesOf(flattenDateGroups(value.data?.meetings_excerpt?.meetings));
}

export function clubScheduleDates(value: ClubScheduleResponse) {
    const data = value.data as Record<string, unknown>;

    const flat = Array.isArray(data.meetings) ? data.meetings : [];
    const dated = Object.entries(data)
        .filter(([key]) => DATE_KEY.test(key))
        .flatMap(([, list]) => (Array.isArray(list) ? list : []));

    return datesOf([...flat, ...dated]);
}
