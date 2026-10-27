import * as cheerio from "cheerio";
import { LeagueTableResponseSchema, type LeagueTableResponse } from "../../schemas.js";
import { parseUpstream } from "../../upstream/parse.js";
import { RemixContextParseError } from "./remixContext.js";

// "promotionPlayoff" / "relegationPlayoff" sind die Relegationsplätze (Symbol rise-secondary / fall-secondary).
export type PromotionState =
    | "promotion"
    | "promotionPlayoff"
    | "relegation"
    | "relegationPlayoff"
    | "none";

// Auf- und Abstiegsplätze sind in der Seite nur als Symbol (#rise / #fall) markiert.
function promotionStateOfRow(rowHtml: string): PromotionState {
    if (/#rise(?:["'#\s>]|$)/i.test(rowHtml)) {
        return "promotion";
    }

    if (/#rise-secondary(?:["'#\s>]|$)/i.test(rowHtml)) {
        return "promotionPlayoff";
    }

    if (/#fall(?:["'#\s>]|$)/i.test(rowHtml)) {
        return "relegation";
    }

    return /#fall-secondary(?:["'#\s>]|$)/i.test(rowHtml) ? "relegationPlayoff" : "none";
}

/**
 * Auf/Abstieg einer Tabellenzeile aus den Loader Daten bzw. der API.
 * `rise_fall_state` ist die genauere Angabe (rise, riseRelegation, fallRelegation, fall, none),
 * `tendency` der Ersatz.
 */
export function promotionStateOfApiRow(row: {
    rise_fall_state?: string | null;
    tendency?: string | null;
}): PromotionState {
    const state = row.rise_fall_state ?? row.tendency;

    switch (state) {
        case "rise":
            return "promotion";
        case "riseRelegation":
            return "promotionPlayoff";
        case "fall":
            return "relegation";
        case "fallRelegation":
            return "relegationPlayoff";
        default:
            return "none";
    }
}

function toInt(value: string | undefined): number | null {
    const parsed = Number.parseInt((value ?? "").replace(/[^\d-]/g, ""), 10);

    return Number.isFinite(parsed) ? parsed : null;
}

function parseRelation(value: string | undefined): [number | null, number | null] {
    const [left, right] = (value ?? "").split(":");

    return [toInt(left), toInt(right)];
}

type ColumnKey = "rank" | "team" | "meetings" | "won" | "tie" | "lost" | "matches" | "relation" | "points";

const COLUMN_PATTERNS: Array<[ColumnKey, RegExp]> = [
    ["rank", /^rang\b/],
    ["team", /^mannschaft\b/],
    ["meetings", /^beg/],
    ["won", /^s$/],
    ["tie", /^u$/],
    ["lost", /^n$/],
    ["matches", /^spiele\b/],
    ["relation", /^\+\/-$/],
    ["points", /^punkte\b/]
];

function columnIndexes(headers: string[]): Partial<Record<ColumnKey, number>> {
    const indexes: Partial<Record<ColumnKey, number>> = {};

    headers.forEach((header, index) => {
        const match = COLUMN_PATTERNS.find(([key, pattern]) => indexes[key] === undefined && pattern.test(header));

        if (match) {
            indexes[match[0]] = index;
        }
    });

    return indexes;
}

/**
 * Letzte Stufe, wenn die Seite keine Loader Daten mehr enthält: liest die sichtbare Tabelle.
 * Die Spalten werden über die Kopfzeile gefunden (Rang, Mannschaft, Beg., S, U, N, Spiele X:Y, +/-,
 * Punkte X:Y), nicht über feste Positionen. Rang, Mannschaft und Punkte müssen vorhanden sein.
 * Liefert nur die Felder, die in der Tabelle stehen.
 */
export function parseLeagueTableFromHtmlTable(html: string): LeagueTableResponse {
    const $ = cheerio.load(html);

    // Nur die Kopfzeile: thead, sonst die erste Zeile.
    const headersOf = (element: Parameters<typeof $>[0]) => {
        const head = $(element).find("thead th");

        return (head.length > 0 ? head : $(element).find("tr").first().find("th"))
            .map((_, th) => $(th).text().replace(/\s+/g, " ").trim().toLowerCase())
            .get();
    };

    const table = $("table")
        .filter((_, element) => {
            const headers = headersOf(element);

            return headers.some((h) => /^rang\b/.test(h)) && headers.some((h) => /^mannschaft\b/.test(h));
        })
        .first();

    if (table.length === 0) {
        throw new RemixContextParseError("League table element was not found in HTML.");
    }

    const columns = columnIndexes(headersOf(table));

    if (columns.rank === undefined || columns.team === undefined || columns.points === undefined) {
        throw new RemixContextParseError(
            "League table is missing the columns Rang, Mannschaft or Punkte."
        );
    }

    const { rank, team, meetings, won, tie, lost, matches, relation, points } = columns;
    const requiredCells = Math.max(...Object.values(columns)) + 1;
    const rows: unknown[] = [];

    table.find("tr").each((_, element) => {
        const row = $(element);
        const cells = row.children("td");

        if (cells.length < requiredCells) {
            return;
        }

        const text = (index: number | undefined) =>
            index === undefined ? undefined : $(cells[index]).text().replace(/\s+/g, " ").trim();
        const link = $(cells[team]).find("a").first().attr("href") ?? "";
        const teamId = /\/mannschaft\/(\d+)\//.exec(link)?.[1] ?? null;

        const [matchesWon, matchesLost] = parseRelation(text(matches));
        const [pointsWon, pointsLost] = parseRelation(text(points));

        rows.push({
            team_id: teamId,
            team_name: text(team),
            table_rank: toInt(text(rank)),
            meetings_count: toInt(text(meetings)),
            meetings_won: toInt(text(won)),
            meetings_tie: toInt(text(tie)),
            meetings_lost: toInt(text(lost)),
            matches_won: matchesWon,
            matches_lost: matchesLost,
            matches_relation: text(relation) ?? null,
            points_won: pointsWon,
            points_lost: pointsLost,
            promotion_state: promotionStateOfRow($.html(element))
        });
    });

    if (rows.length === 0) {
        throw new RemixContextParseError("League table has no rows.");
    }

    return parseUpstream(LeagueTableResponseSchema, { data: rows, error: null }, "league_table_html");
}
