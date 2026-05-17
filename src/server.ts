import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { getFromCache, setCache } from "./cache.js";
import {
    searchPlayers,
    searchClubs,
    getClubTeams,
    getLeagueTable,
    UpstreamDisabledError,
    UpstreamError,
    UpstreamRateLimitError,
    LocalRateLimitError, getLeagueSchedule
} from "./myttClient.js";
import type {
    PlayerSearchResponse,
    ClubSearchResponse,
    ClubTeamsResponse,
    LeagueTableResponse, LeagueScheduleResponse
} from "./schemas.js";

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

function handleApiError(error: unknown, reply: any) {
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

    return reply.code(500).send({
        error: {
            code: "INTERNAL_ERROR",
            message: "Unerwarteter Serverfehler."
        }
    });
}

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

        setCache(cacheKey, result, 5 * 60 * 1000);

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

        setCache(cacheKey, result, 15 * 60 * 1000);

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

app.get("/api/clubs/:organization/:clubNumber/teams", async (request, reply) => {
    const params = request.params as {
        organization?: string;
        clubNumber?: string;
    };

    const organization = params.organization?.trim().toUpperCase() ?? "";
    const clubNumber = params.clubNumber?.trim() ?? "";

    if (!organization || !clubNumber) {
        return reply.code(400).send({
            error: {
                code: "INVALID_INPUT",
                message: "organization und clubNumber sind erforderlich."
            }
        });
    }

    const cacheKey = `club-teams:${organization}:${clubNumber}`;

    const cached = getFromCache<ClubTeamsResponse>(cacheKey);

    if (cached) {
        return {
            data: cached,
            meta: {
                source: "cache"
            }
        };
    }

    try {
        const result = await getClubTeams({
            organization,
            clubNumber
        });

        setCache(cacheKey, result, 60 * 60 * 1000);

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

app.get("/api/leagues/:association/:groupId/table", async (request, reply) => {
    const params = request.params as {
        association?: string;
        groupId?: string;
    };

    const association = params.association?.trim().toUpperCase() ?? "";
    const groupId = params.groupId?.trim() ?? "";

    if (!association || !groupId) {
        return reply.code(400).send({
            error: {
                code: "INVALID_INPUT",
                message: "association und groupId sind erforderlich."
            }
        });
    }

    const cacheKey = `league-table:${association}:${groupId}`;

    const cached = getFromCache<LeagueTableResponse>(cacheKey);

    if (cached) {
        return {
            data: cached,
            meta: {
                source: "cache"
            }
        };
    }

    try {
        const result = await getLeagueTable({
            association,
            groupId
        });

        setCache(cacheKey, result, 15 * 60 * 1000);

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

app.get(
    "/api/leagues/:association/:season/:groupId/schedule",
    async (request, reply) => {
        const params = request.params as {
            association?: string;
            season?: string;
            groupId?: string;
        };

        const query = request.query as {
            leagueSlug?: string;
            filter?: string;
        };

        const association = params.association?.trim().toUpperCase() ?? "";
        const season = params.season?.trim() ?? "";
        const groupId = params.groupId?.trim() ?? "";
        const leagueSlug = query.leagueSlug?.trim() || "x";

        const filter =
            query.filter === "vr" || query.filter === "rr" || query.filter === "gesamt"
                ? query.filter
                : "gesamt";

        if (!association || !season || !groupId) {
            return reply.code(400).send({
                error: {
                    code: "INVALID_INPUT",
                    message: "association, season und groupId sind erforderlich."
                }
            });
        }

        const cacheKey = `league-schedule:${association}:${season}:${groupId}:${leagueSlug}:${filter}`;

        const cached = getFromCache<LeagueScheduleResponse>(cacheKey);

        if (cached) {
            return {
                data: cached,
                meta: {
                    source: "cache"
                }
            };
        }

        try {
            const result = await getLeagueSchedule({
                association,
                season,
                groupId,
                leagueSlug,
                filter
            });

            setCache(cacheKey, result, 60 * 60 * 1000);

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
    }
);

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