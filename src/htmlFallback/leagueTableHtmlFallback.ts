// src/htmlFallback/leagueTableHtmlFallback.ts

import { CACHE_TTL } from "../constants.js";
import { readMyttHtml } from "../myttHtmlReader.js";
import {
    getRemixLoaderData,
    getRemixRouteData,
    parseRemixContextFromHtml,
    RemixContextParseError
} from "./remixContext.js";
import { buildLeagueTableHtmlPathCandidates } from "./leagueRouteResolver.js";
import {
    LeagueTableResponseSchema,
    type LeagueTableResponse
} from "../schemas.js";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseLeagueTableFromHtml(html: string): LeagueTableResponse {
    const context = parseRemixContextFromHtml(html);
    const loaderData = getRemixLoaderData(context);

    const routeData = getRemixRouteData({
        loaderData,
        routeKeySuffix: "/tabelle.$filter"
    });

    const tableData = routeData.data;

    if (!isRecord(tableData)) {
        throw new RemixContextParseError("League table route data is missing.");
    }

    const leagueTable = tableData.league_table;

    if (!Array.isArray(leagueTable)) {
        throw new RemixContextParseError("league_table is missing or not an array.");
    }

    return LeagueTableResponseSchema.parse({
        data: leagueTable,
        error: routeData.error ?? null
    });
}

export async function getLeagueTableFromHtml(params: {
    association: string;
    groupId: string;
    filter?: string;
}): Promise<LeagueTableResponse> {
    const paths = buildLeagueTableHtmlPathCandidates({
        association: params.association,
        groupId: params.groupId,
        filter: params.filter
    });

    let lastError: unknown = null;

    for (const path of paths) {
        try {
            const result = await readMyttHtml({
                path,
                cacheKey: `html:league-table:${params.association}:${params.groupId}:${params.filter ?? "gesamt"}:${path}`,
                ttlMs: CACHE_TTL.LEAGUE_TABLE
            });

            return parseLeagueTableFromHtml(result.html);
        } catch (error) {
            lastError = error;
        }
    }

    if (lastError) {
        throw lastError;
    }

    throw new RemixContextParseError("No league table HTML path candidates were available.");
}