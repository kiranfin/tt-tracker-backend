import type { FastifyInstance } from "fastify";
import { getFromCache, setCache } from "../cache.js";
import { CACHE_TTL } from "../constants.js";
import { getLeagueSchedule, getLeagueTable } from "../myttClient.js";
import type {
    LeagueScheduleResponse,
    LeagueTableResponse
} from "../schemas.js";
import { handleApiError } from "../utils/errors.js";

export async function leagueRoutes(app: FastifyInstance) {
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

            setCache(cacheKey, result, CACHE_TTL.LEAGUE_TABLE);

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
                query.filter === "vr" ||
                query.filter === "rr" ||
                query.filter === "gesamt"
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

                setCache(cacheKey, result, CACHE_TTL.LEAGUE_SCHEDULE);

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
}