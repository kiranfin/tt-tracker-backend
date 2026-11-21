import { RemixContextParseError, type JsonRecord } from "./remixContext.js";

function asRecord(value: unknown): JsonRecord | null {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : null;
}

/**
 * Loader Daten der Vereinsseite `mannschaften` in die Form von `/api/ttr/teams` ({ data: Mannschaften }).
 * Die Zeilen unter `teams_list.club_teams` haben dieselben Felder wie die API, dazu `team_nr` und `contest_type`.
 *
 * Der Loader holt nebenbei Spieltermine (`meetings_excerpt`) aus dem NU Feed. Scheitert der, kommt `data: null`
 * mit einem Fehler (PT500), obwohl die Mannschaften selbst lesbar wären. Das ist dann ein Lesefehler.
 */
export function clubTeamsPageToApiResponse(routeData: JsonRecord): { data: unknown[]; error: null } {
    const data = asRecord(routeData.data);
    const teams = asRecord(data?.teams_list)?.club_teams;

    if (!Array.isArray(teams)) {
        throw new RemixContextParseError("Mannschaften loader data has no teams_list.club_teams.");
    }

    return { data: teams, error: null };
}

/**
 * Mannschaftsmeldung (`meldungendetails`) in die Form von `/api/ttr/team/players`: nur die Spieler der
 * Mannschaft `teamNumber`, nach Rang sortiert, mit denselben Feldnamen wie die API.
 *
 * `data.team` ist null, solange die Meldung für die Halbserie nicht freigegeben ist (z.B. Rückrunde im Herbst).
 * Das liefert eine leere Liste, kein Fehler. Fehlt `data` ganz, ist es ein Lesefehler.
 */
export function teamLineupToApiResponse(
    routeData: JsonRecord,
    teamNumber: number
): { data: JsonRecord[]; error: null } {
    const data = asRecord(routeData.data);

    if (!data) {
        throw new RemixContextParseError("Meldung loader data has no data.");
    }

    const rows = Array.isArray(data.team) ? data.team : [];

    const players = rows
        .map(asRecord)
        .filter((row): row is JsonRecord => row !== null && Number(row.team_number) === teamNumber)
        .map((row) => ({
            firstname: row.player_firstname ?? null,
            lastname: row.player_lastname ?? null,
            internal_id: row.player_id ?? null,
            rank: row.player_rank ?? null
        }))
        .sort((a, b) => Number(a.rank ?? Infinity) - Number(b.rank ?? Infinity));

    return { data: players, error: null };
}
