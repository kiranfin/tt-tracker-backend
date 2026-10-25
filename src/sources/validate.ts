import { CACHE_TTL } from "../constants.js";
import { writeJsonLog } from "../fileLogger.js";
import type {
    ClubScheduleResponse,
    LeagueScheduleResponse,
    LeagueTableResponse,
    TeamBalancesResponse,
    TeamScheduleResponse
} from "../schemas.js";
import { UpstreamFormatError } from "../upstream/errors.js";

/**
 * Plausibilitätsprüfung nach dem Schema. Das Schema akzeptiert fast alles (alle Felder optional),
 * damit wäre eine leere oder verschobene Antwort "gültig". Hier stehen die Regeln, die bei
 * echten Daten immer gelten. Eine Verletzung heißt: das Format hat sich geändert, nicht die Daten.
 *
 * Harte Regeln werfen UpstreamFormatError (der Aufrufer fällt auf eine andere Quelle oder den
 * Stale Cache zurück). Weiche Regeln (z.B. Strafpunkte) werden nur geloggt.
 */

const MAX_ISSUES = 10;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown): number | null {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }

    if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
        return Number(value);
    }

    return null;
}

function hasText(value: unknown): boolean {
    return typeof value === "string" && value.trim().length > 0;
}

function warn(source: string, issues: string[]) {
    if (issues.length > 0) {
        void writeJsonLog("plausibility_warning", {
            source,
            issues: issues.slice(0, MAX_ISSUES)
        });
    }
}

function failIfAny(source: string, issues: string[]) {
    if (issues.length > 0) {
        throw new UpstreamFormatError(source, issues.slice(0, MAX_ISSUES));
    }
}

export function validateLeagueTable<T extends LeagueTableResponse>(table: T, source: string): T {
    const issues: string[] = [];
    const warnings: string[] = [];

    if (table.data.length === 0) {
        issues.push("table has no rows");
    }

    table.data.forEach((row, index) => {
        const label = `row ${index + 1}`;

        if (!hasText(row.team_name)) {
            issues.push(`${label}: team_name is missing`);
        }

        // Ausgeschlossene Mannschaften stehen ohne Rang in der Tabelle.
        if (row.is_excluded !== true && toNumber(row.table_rank) === null) {
            issues.push(`${label}: table_rank is not a number`);
        }

        const count = toNumber(row.meetings_count);
        const won = toNumber(row.meetings_won);
        const tie = toNumber(row.meetings_tie);
        const lost = toNumber(row.meetings_lost);

        if (count !== null && won !== null && tie !== null && lost !== null && won + tie + lost !== count) {
            issues.push(`${label}: S + U + N (${won + tie + lost}) differs from Beg. (${count})`);
        }

        // Strafpunkte verschieben die Punkte, daher nur eine Warnung.
        const pointsWon = toNumber(row.points_won);

        if (won !== null && tie !== null && pointsWon !== null && pointsWon !== 2 * won + tie) {
            warnings.push(`${label}: points_won (${pointsWon}) differs from 2*S + U (${2 * won + tie})`);
        }
    });

    warn(source, warnings);
    failIfAny(source, issues);

    return table;
}

function checkMeetings(meetings: unknown[], source: string) {
    const issues: string[] = [];

    meetings.forEach((meeting, index) => {
        const label = `meeting ${index + 1}`;

        if (!isRecord(meeting)) {
            issues.push(`${label}: is not an object`);
            return;
        }

        if (!hasText(meeting.date)) {
            issues.push(`${label}: date is missing`);
        }

        if (!hasText(meeting.team_home) && !hasText(meeting.team_away)) {
            issues.push(`${label}: team_home and team_away are missing`);
        }
    });

    failIfAny(source, issues);
}

// [{ "2025-10-04": [meeting, ...] }, ...] zu einer flachen Liste.
function flattenDateGroups(groups: unknown): unknown[] {
    if (!Array.isArray(groups)) {
        return [];
    }

    return groups.flatMap((group) =>
        isRecord(group) ? Object.values(group).flatMap((list) => (Array.isArray(list) ? list : [])) : []
    );
}

export function validateMeetings(meetings: unknown[], source: string) {
    checkMeetings(meetings, source);
}

export function validateLeagueSchedule<T extends LeagueScheduleResponse>(value: T, source: string): T {
    checkMeetings(flattenDateGroups(value.data?.meetings), source);

    return value;
}

export function validateTeamSchedule<T extends TeamScheduleResponse>(value: T, source: string): T {
    const excerpt = value.data?.meetings_excerpt;

    checkMeetings(flattenDateGroups(excerpt?.meetings), source);

    return value;
}

export function validateClubSchedule<T extends ClubScheduleResponse>(value: T, source: string): T {
    const data = value.data as Record<string, unknown>;

    // Je nach Antwort liegen die Spiele in `meetings` (flach) oder unter Datumsschlüsseln in `data`.
    const dated = Object.entries(data)
        .filter(([key]) => DATE_KEY.test(key))
        .flatMap(([, list]) => (Array.isArray(list) ? list : []));

    checkMeetings([...(Array.isArray(data.meetings) ? data.meetings : []), ...dated], source);

    return value;
}

/** Leere Spielpläne und Tabellen sind gültig (Saison nicht begonnen), sollen aber nicht lange gecacht werden. */
export function isEmptyLeagueTable(table: LeagueTableResponse): boolean {
    return table.data.length === 0;
}

export function isEmptyLeagueSchedule(value: LeagueScheduleResponse): boolean {
    return flattenDateGroups(value.data?.meetings).length === 0;
}

export function isEmptyTeamSchedule(value: TeamScheduleResponse): boolean {
    return flattenDateGroups(value.data?.meetings_excerpt?.meetings).length === 0;
}

export function isEmptyClubSchedule(value: ClubScheduleResponse): boolean {
    const data = value.data as Record<string, unknown>;

    return (
        (!Array.isArray(data.meetings) || data.meetings.length === 0) &&
        !Object.entries(data).some(([key, list]) => DATE_KEY.test(key) && Array.isArray(list) && list.length > 0)
    );
}

export function isEmptyTeamBalances(value: TeamBalancesResponse): boolean {
    // Je nach Liga stehen die Bilanzen in player_balances oder in balancesheet.
    const data = (value.data ?? {}) as Record<string, unknown>;

    return ["player_balances", "balancesheet"].every((key) => {
        const list = data[key];

        return !Array.isArray(list) || list.length === 0;
    });
}

/** Cache TTL, die für leere Ergebnisse auf CACHE_TTL.EMPTY_RESULT gekürzt wird. */
export function ttlUnlessEmpty<T>(ttlMs: number, isEmpty: (value: T) => boolean) {
    return (value: T) => (isEmpty(value) ? Math.min(ttlMs, CACHE_TTL.EMPTY_RESULT) : ttlMs);
}
