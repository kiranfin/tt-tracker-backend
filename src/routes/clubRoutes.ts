import type { FastifyInstance } from "fastify";
import { getFromCache, setCache } from "../cache.js";
import { CACHE_TTL } from "../constants.js";
import { getClubTeams } from "../myttClient.js";
import type { ClubTeamsResponse } from "../schemas.js";
import { handleApiError } from "../utils/errors.js";

export async function clubRoutes(app: FastifyInstance) {
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

            setCache(cacheKey, result, CACHE_TTL.CLUB_TEAMS);

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