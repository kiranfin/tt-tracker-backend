import type { FastifyInstance } from "fastify";
import { getFromCache, setCache } from "../cache.js";
import { CACHE_TTL } from "../constants.js";
import { searchPlayers, searchClubs } from "../myttClient.js";
import type {
    ClubSearchResponse,
    PlayerSearchResponse
} from "../schemas.js";
import { handleApiError } from "../utils/errors.js";

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

        const cacheKey = `players:${q.toLowerCase()}:${page}:${pagesize}`;
        const cached = getFromCache<PlayerSearchResponse>(cacheKey);

        if (cached) {
            return {
                data: cached,
                meta: {
                    source: "cache"
                }
            };
        }

        try {
            const result = await searchPlayers({
                query: q,
                page,
                pagesize
            });

            setCache(cacheKey, result, CACHE_TTL.PLAYER_SEARCH);

            return {
                data: result,
                meta: {
                    source: "upstream"
                }
            };
        } catch (error) {
            request.log.error(error);
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

        const cacheKey = `clubs:${q.toLowerCase()}:${page}:${pagesize}`;
        const cached = getFromCache<ClubSearchResponse>(cacheKey);

        if (cached) {
            return {
                data: cached,
                meta: {
                    source: "cache"
                }
            };
        }

        try {
            const result = await searchClubs({
                query: q,
                page,
                pagesize
            });

            setCache(cacheKey, result, CACHE_TTL.CLUB_SEARCH);

            return {
                data: result,
                meta: {
                    source: "upstream"
                }
            };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });
}