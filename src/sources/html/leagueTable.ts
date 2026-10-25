import * as cheerio from "cheerio";
import { LeagueTableResponseSchema, type LeagueTableResponse } from "../../schemas.js";
import { RemixContextParseError } from "./remixContext.js";

export type PromotionState = "promotion" | "relegation" | "none";

// Auf- und Abstiegsplätze sind in der Seite nur als Symbol (#rise / #fall) markiert.
function promotionStateOfRow(rowHtml: string): PromotionState {
    if (/#rise(?:["'#\s>]|$)/i.test(rowHtml)) {
        return "promotion";
    }

    return /#fall(?:["'#\s>]|$)/i.test(rowHtml) ? "relegation" : "none";
}

export function extractPromotionStatesFromTableHtml(html: string): PromotionState[] {
    const rows = html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];

    return rows
        .filter((row) => {
            const text = row
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim();

            return text.length > 0 && !/^rang\s+mannschaft/i.test(text);
        })
        .map(promotionStateOfRow);
}

function toInt(value: string | undefined): number | null {
    const parsed = Number.parseInt((value ?? "").replace(/[^\d-]/g, ""), 10);

    return Number.isFinite(parsed) ? parsed : null;
}

function parseRelation(value: string): [number | null, number | null] {
    const [left, right] = value.split(":");

    return [toInt(left), toInt(right)];
}

/**
 * Letzte Stufe, wenn die Seite keine Loader Daten mehr enthält: liest die sichtbare Tabelle.
 * Spalten: Rang, Mannschaft, Beg., S, U, N, Spiele (X:Y), +/-, Punkte (X:Y).
 * Liefert nur die Felder, die in der Tabelle stehen.
 */
export function parseLeagueTableFromHtmlTable(html: string): LeagueTableResponse {
    const $ = cheerio.load(html);

    const table = $("table")
        .filter((_, element) => {
            const header = $(element).find("thead").text().replace(/\s+/g, " ");

            return /Rang/i.test(header) && /Mannschaft/i.test(header);
        })
        .first();

    if (table.length === 0) {
        throw new RemixContextParseError("League table element was not found in HTML.");
    }

    const rows: unknown[] = [];

    table.find("tbody tr").each((_, element) => {
        const row = $(element);
        const cells = row.find("td");

        if (cells.length < 9) {
            return;
        }

        const text = (index: number) => $(cells[index]).text().replace(/\s+/g, " ").trim();
        const link = $(cells[1]).find("a").first().attr("href") ?? "";
        const teamId = /\/mannschaft\/(\d+)\//.exec(link)?.[1] ?? null;

        const [matchesWon, matchesLost] = parseRelation(text(6));
        const [pointsWon, pointsLost] = parseRelation(text(8));

        rows.push({
            team_id: teamId,
            team_name: text(1),
            table_rank: toInt(text(0)),
            meetings_count: toInt(text(2)),
            meetings_won: toInt(text(3)),
            meetings_tie: toInt(text(4)),
            meetings_lost: toInt(text(5)),
            matches_won: matchesWon,
            matches_lost: matchesLost,
            matches_relation: text(6),
            points_won: pointsWon,
            points_lost: pointsLost,
            promotion_state: promotionStateOfRow($.html(element))
        });
    });

    if (rows.length === 0) {
        throw new RemixContextParseError("League table has no rows.");
    }

    return LeagueTableResponseSchema.parse({ data: rows, error: null });
}
