import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { getFromCache, setCache } from "./cache.js";
import {
    searchPlayers,
    UpstreamDisabledError,
    UpstreamError,
    UpstreamRateLimitError,
    LocalRateLimitError
} from "./myttClient.js";
import type { PlayerSearchResponse } from "./schemas.js";

const app = Fastify({
    logger: true
});

await app.register(cors, {
    origin: true
});

app.get("/health", async () => {
    return {
        ok: true,
        service: "tt-tracker-api"
    };
});

app.get("/api/search/players", async (request, reply) => {
    const queryParams = request.query as {
        q?: string;
        page?: string;
        pagesize?: string;
    };

    const q = queryParams.q?.trim() ?? "";
    const page = Number(queryParams.page ?? 1);
    const pagesize = Number(queryParams.pagesize ?? 8);

    if (q.length < 3) {
        return reply.code(400).send({
            error: {
                code: "INVALID_INPUT",
                message: "Bitte mindestens 3 Zeichen eingeben."
            }
        });
    }

    const safePage = Number.isFinite(page) && page > 0 ? page : 1;

    const safePagesize =
        Number.isFinite(pagesize) && pagesize > 0 && pagesize <= 20
            ? pagesize
            : 8;

    const cacheKey = `players:${q.toLowerCase()}:${safePage}:${safePagesize}`;

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
            page: safePage,
            pagesize: safePagesize
        });

        setCache(cacheKey, result, 5 * 60 * 1000);

        return {
            data: result,
            meta: {
                source: "upstream"
            }
        };
    } catch (error) {
        if (error instanceof LocalRateLimitError) {
            return reply.code(429).send({
                error: {
                    code: "RATE_LIMITED",
                    message:
                        "Das eigene Backend hat das gesetzte Anfrage-Limit erreicht. Bitte später erneut versuchen."
                }
            });
        }

        if (error instanceof UpstreamRateLimitError) {
            return reply.code(429).send({
                error: {
                    code: "RATE_LIMITED",
                    message:
                        "myTischtennis ist gerade rate-limited. Bitte später erneut versuchen."
                }
            });
        }

        if (error instanceof UpstreamDisabledError) {
            return reply.code(503).send({
                error: {
                    code: "UPSTREAM_DISABLED",
                    message: "Externe Datenquelle ist aktuell deaktiviert."
                }
            });
        }

        if (error instanceof UpstreamError) {
            return reply.code(502).send({
                error: {
                    code: "UPSTREAM_ERROR",
                    message: error.message
                }
            });
        }

        request.log.error(error);

        return reply.code(500).send({
            error: {
                code: "INTERNAL_ERROR",
                message: "Unerwarteter Serverfehler."
            }
        });
    }
});

const port = Number(process.env.PORT ?? 4001);

try {
    await app.listen({
        port,
        host: "127.0.0.1"
    });

    app.log.info(`Server läuft auf http://127.0.0.1:${port}`);
} catch (error) {
    app.log.error(error);
    process.exit(1);
}