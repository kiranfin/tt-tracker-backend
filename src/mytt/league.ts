import { config } from "../config.js";
import { LeagueScheduleResponseSchema, LeagueTableResponseSchema } from "../schemas.js";
import type { LeagueScheduleResponse, LeagueTableResponse } from "../schemas.js";
import { fetchWithFallback } from "../sources/fetchWithFallback.js";
import { fetchHtmlPage } from "../sources/html/fetchPage.js";
import {
    parseLeagueTableFromHtmlTable,
    promotionStateOfApiRow
} from "../sources/html/leagueTable.js";
import { getRouteDataFromHtml, RemixContextParseError } from "../sources/html/remixContext.js";
import { validateLeagueSchedule, validateLeagueTable } from "../sources/validate.js";
import { UpstreamFormatError } from "../upstream/errors.js";
import { parseUpstream } from "../upstream/parse.js";
import { getJsonFromMytt, getRouteDataWithHtmlFallback } from "./request.js";
import { asRecord } from "./values.js";

export function normalizeFrontendLeagueTableResponse(value: unknown): LeagueTableResponse {
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

    return parseUpstream(
        LeagueTableResponseSchema,
        {
            data: rows,
            error: root.error ?? data.error ?? null
        },
        "league_table"
    );
}

export const LEAGUE_TABLE_ROUTE_ID =
    "routes/click-tt+/$association+/$season+/$type+/$groupname.gruppe.$urlid+/tabelle.$filter";

export const LEAGUE_SCHEDULE_ROUTE_ID =
    "routes/click-tt+/$association+/$season+/$type+/$groupname.gruppe.$urlid+/spielplan.$filter";

export function buildLeaguePagePath(params: {
    association: string;
    season: string;
    groupId: string;
    leagueSlug?: string;
    page: "tabelle" | "spielplan";
    filter?: "gesamt" | "vr" | "rr";
}) {
    const segments = [
        "click-tt",
        params.association,
        params.season,
        "ligen",
        toLeagueSlug(params.leagueSlug),
        "gruppe",
        params.groupId,
        params.page,
        params.filter ?? "gesamt"
    ];

    return `/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

function withPromotionStates(table: LeagueTableResponse): LeagueTableResponse {
    return {
        ...table,
        data: table.data.map((row) => ({
            ...row,
            promotion_state: promotionStateOfApiRow(row)
        }))
    };
}

// Primär die Loader Daten der Seite (gleiche Felder wie die API). Nur wenn die fehlen oder nicht
// mehr passen, die sichtbare Tabelle lesen: dieser Parser ist unabhängig vom Loader Format.
async function getLeagueTableFromPage(path: string): Promise<LeagueTableResponse> {
    const html = await fetchHtmlPage({ path });

    try {
        return validateLeagueTable(
            withPromotionStates(
                normalizeFrontendLeagueTableResponse(
                    getRouteDataFromHtml(html, LEAGUE_TABLE_ROUTE_ID)
                )
            ),
            "league_table:html"
        );
    } catch (error) {
        if (!(error instanceof RemixContextParseError) && !(error instanceof UpstreamFormatError)) {
            throw error;
        }

        try {
            return validateLeagueTable(
                parseLeagueTableFromHtmlTable(html),
                "league_table:html_table"
            );
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
        name: "league_table",
        path,
        searchParams,
        schema: {
            parse: normalizeFrontendLeagueTableResponse
        }
    });

    return validateLeagueTable(withPromotionStates(table), "league_table");
}

export async function getLeagueTable(params: {
    association: string;
    season: string;
    groupId: string;
    leagueSlug?: string;
    filter?: "gesamt" | "vr" | "rr";
}): Promise<LeagueTableResponse> {
    const path = buildLeaguePagePath({ ...params, page: "tabelle" });

    const searchParams = new URLSearchParams({
        _data: LEAGUE_TABLE_ROUTE_ID
    });

    if (!config.upstream.htmlFallbackEnabled) {
        return getLeagueTableFromApi(path, searchParams);
    }

    return fetchWithFallback({
        name: "league_table",
        // Die Seite hat einen eigenen Parser (sichtbare Tabelle), der vom Loader Format unabhängig ist.
        fallbackOnFormatError: true,
        primary: () => getLeagueTableFromApi(path, searchParams),
        fallback: () => getLeagueTableFromPage(path)
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
    const searchParams = new URLSearchParams({ _data: LEAGUE_SCHEDULE_ROUTE_ID });

    return getRouteDataWithHtmlFallback({
        name: "league_schedule",
        path: buildLeaguePagePath({ ...params, page: "spielplan" }),
        searchParams,
        schema: LeagueScheduleResponseSchema,
        validate: validateLeagueSchedule
    });
}
