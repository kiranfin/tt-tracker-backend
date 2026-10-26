import type { FastifyInstance } from "fastify";
import { readThrough } from "../cache/index.js";
import { CACHE_TTL } from "../constants.js";
import { searchPlayers, searchClubs } from "../mytt/index.js";
import { searchKnownClubs, searchKnownPlayers } from "../sources/knownSearch.js";
import { handleApiError } from "../utils/errors.js";
import { buildMeta } from "../utils/responseMeta.js";

function parseSearchParams(query: {
    q?: string;
    page?: string;
    pagesize?: string;
}) {
    const q = query.q?.trim() ?? "";
    const page = Number(query.page ?? 1);
    const pagesize = Number(query.pagesize ?? 8);

    const safePage = Number.isFinite(page) && page > 0 ? page : 1;

    const safePagesize =
        Number.isFinite(pagesize) && pagesize > 0 && pagesize <= 20
            ? pagesize
            : 8;

    return {
        q,
        page: safePage,
        pagesize: safePagesize
    };
}

// Antwort aus der Notfall Suche (nur bereits bekannte Spieler oder Vereine).
const KNOWN_RESULTS_META = {
    source: "stale",
    origin: "upstream",
    fetchedAt: null,
    fallback: "known_results"
} as const;

export async function searchRoutes(app: FastifyInstance) {
    app.get("/api/search/players", async (request, reply) => {
        const { q, page, pagesize } = parseSearchParams(
            request.query as {
                q?: string;
                page?: string;
                pagesize?: string;
            }
        );

        if (q.length < 3) {
            return reply.code(400).send({
                error: {
                    code: "INVALID_INPUT",
                    message: "Bitte mindestens 3 Zeichen eingeben."
                }
            });
        }

        try {
            const result = await readThrough({
                key: `players:${q.toLowerCase()}:${page}:${pagesize}`,
                ttlMs: CACHE_TTL.PLAYER_SEARCH,
                load: () =>
                    searchPlayers({
                        query: q,
                        page,
                        pagesize
                    })
            });

            return {
                data: result.value,
                meta: buildMeta(result)
            };
        } catch (error) {
            request.log.error(error);

            const known = searchKnownPlayers({ query: q, page, pagesize });

            if (known.results.length > 0) {
                return { data: known, meta: KNOWN_RESULTS_META };
            }

            return handleApiError(error, reply);
        }
    });

    app.get("/api/search/clubs", async (request, reply) => {
        const { q, page, pagesize } = parseSearchParams(
            request.query as {
                q?: string;
                page?: string;
                pagesize?: string;
            }
        );

        if (q.length < 3) {
            return reply.code(400).send({
                error: {
                    code: "INVALID_INPUT",
                    message: "Bitte mindestens 3 Zeichen eingeben."
                }
            });
        }

        try {
            const result = await readThrough({
                key: `clubs:${q.toLowerCase()}:${page}:${pagesize}`,
                ttlMs: CACHE_TTL.CLUB_SEARCH,
                load: () =>
                    searchClubs({
                        query: q,
                        page,
                        pagesize
                    })
            });

            return {
                data: result.value,
                meta: buildMeta(result)
            };
        } catch (error) {
            request.log.error(error);

            const known = searchKnownClubs({ query: q, page, pagesize });

            if (known.results.length > 0) {
                return { data: known, meta: KNOWN_RESULTS_META };
            }

            return handleApiError(error, reply);
        }
    });
}