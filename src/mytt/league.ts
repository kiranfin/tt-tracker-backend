import { ZodError } from "zod";
import { config } from "../config.js";
import { LeagueScheduleResponseSchema, LeagueTableResponseSchema } from "../schemas.js";
import type { LeagueScheduleResponse, LeagueTableResponse } from "../schemas.js";
import { fetchWithFallback } from "../sources/fetchWithFallback.js";
import { fetchHtmlPage } from "../sources/html/fetchPage.js";
import {
    extractPromotionStatesFromTableHtml,
    parseLeagueTableFromHtmlTable,
    type PromotionState
} from "../sources/html/leagueTable.js";
import { getRouteDataFromHtml, RemixContextParseError } from "../sources/html/remixContext.js";
import { getJsonFromMytt, getRouteDataWithHtmlFallback } from "./request.js";
import { asRecord } from "./values.js";

function normalizeFrontendLeagueTableResponse(value: unknown): LeagueTableResponse {
    const root = asRecord(value);
    const data = asRecord(root.data);

    const rows =
        Array.isArray(root.data)
            ? root.data
            : Array.isArray(data.league_table)
                ? data.league_table
                : Array.isArray(root.league_table)
                    ? root.league_table
                    : [];

    return LeagueTableResponseSchema.parse({
        data: rows,
        error: root.error ?? data.error ?? null
    });
}

const LEAGUE_TABLE_ROUTE_ID =
    "routes/click-tt+/$association+/$season+/$type+/$groupname.gruppe.$urlid+/tabelle.$filter";

function applyPromotionStates(
    table: LeagueTableResponse,
    promotionStates: PromotionState[]
): LeagueTableResponse {
    return {
        ...table,
        data: table.data.map((row, index) => ({
            ...row,
            promotion_state: promotionStates[index] ?? "none"
        }))
    };
}

// Ein einziger Seitenabruf liefert Tabelle (Loader Daten) und Auf/Abstiegs Symbole.
async function getLeagueTableFromPage(path: string): Promise<LeagueTableResponse> {
    const html = await fetchHtmlPage({ path });

    try {
        const table = normalizeFrontendLeagueTableResponse(
            getRouteDataFromHtml(html, LEAGUE_TABLE_ROUTE_ID)
        );

        return applyPromotionStates(table, extractPromotionStatesFromTableHtml(html));
    } catch (error) {
        if (!(error instanceof RemixContextParseError) && !(error instanceof ZodError)) {
            throw error;
        }

        // Keine brauchbaren Loader Daten (z.B. Framework Update): sichtbare Tabelle lesen.
        try {
            return parseLeagueTableFromHtmlTable(html);
        } catch {
            throw error;
        }
    }
}

async function getLeagueTableFromApi(
    path: string,
    searchParams: URLSearchParams
): Promise<LeagueTableResponse> {
    const table = await getJsonFromMytt({
        path,
        searchParams,
        schema: {
            parse: normalizeFrontendLeagueTableResponse
        }
    });

    // Ohne Seite gibt es keine Auf/Abstiegs Symbole, die Tendenz der API entspricht ihnen.
    return applyPromotionStates(
        table,
        table.data.map((row): PromotionState => {
            if (row.tendency === "rise") {
                return "promotion";
            }

            return row.tendency === "fall" ? "relegation" : "none";
        })
    );
}

export async function getLeagueTable(params: {
    association: string;
    season: string;
    groupId: string;
    leagueSlug?: string;
    filter?: "gesamt" | "vr" | "rr";
}): Promise<LeagueTableResponse> {
    const filter = params.filter ?? "gesamt";
    const leagueSlug = toLeagueSlug(params.leagueSlug);

    const path = `/click-tt/${encodeURIComponent(
        params.association
    )}/${encodeURIComponent(params.season)}/ligen/${encodeURIComponent(
        leagueSlug
    )}/gruppe/${encodeURIComponent(params.groupId)}/tabelle/${encodeURIComponent(
        filter
    )}`;

    const searchParams = new URLSearchParams({
        _data: LEAGUE_TABLE_ROUTE_ID
    });

    if (!config.upstream.htmlFallbackEnabled) {
        return getLeagueTableFromApi(path, searchParams);
    }

    return fetchWithFallback({
        name: "league_table",
        primarySource: "html",
        primary: () => getLeagueTableFromPage(path),
        fallback: () => getLeagueTableFromApi(path, searchParams)
    });
}

export function toLeagueSlug(value: string | undefined): string {
    if (!value || value.trim().length === 0) {
        return "x";
    }

    return value
        .trim()
        .replaceAll("ä", "ae")
        .replaceAll("ö", "oe")
        .replaceAll("ü", "ue")
        .replaceAll("Ä", "Ae")
        .replaceAll("Ö", "Oe")
        .replaceAll("Ü", "Ue")
        .replaceAll("ß", "ss")
        .replaceAll(/[^a-zA-Z0-9]+/g, "_")
        .replaceAll(/^_+|_+$/g, "");
}

export async function getLeagueSchedule(params: {
    association: string;
    season: string;
    groupId: string;
    leagueSlug?: string;
    filter?: "gesamt" | "vr" | "rr";
}): Promise<LeagueScheduleResponse> {
    const filter = params.filter ?? "gesamt";
    const leagueSlug = toLeagueSlug(params.leagueSlug);

    const searchParams = new URLSearchParams({
        _data:
            "routes/click-tt+/$association+/$season+/$type+/$groupname.gruppe.$urlid+/spielplan.$filter"
    });

    return getRouteDataWithHtmlFallback({
        name: "league_schedule",
        path: `/click-tt/${encodeURIComponent(
            params.association
        )}/${encodeURIComponent(params.season)}/ligen/${encodeURIComponent(
            leagueSlug
        )}/gruppe/${encodeURIComponent(params.groupId)}/spielplan/${encodeURIComponent(
            filter
        )}`,
        searchParams,
        schema: LeagueScheduleResponseSchema
    });
}
