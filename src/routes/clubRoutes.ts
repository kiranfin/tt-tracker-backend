import type { FastifyInstance } from "fastify";
import { getFromCache, setCache } from "../cache.js";
import { CACHE_TTL } from "../constants.js";
import {
    getClubPlayersFromAndroRanking,
    getClubSchedule,
    getClubTeams
} from "../myttClient.js";
import type {
    ClubPlayersResponse,
    ClubScheduleResponse,
    ClubTeamsResponse
} from "../schemas.js";
import { handleApiError } from "../utils/errors.js";

const CLUB_SCHEDULE_CACHE_TTL =
    (CACHE_TTL as Record<string, number>).CLUB_SCHEDULE ?? CACHE_TTL.CLUB_TEAMS;

const CLUB_PLAYERS_CACHE_TTL =
    (CACHE_TTL as Record<string, number>).CLUB_PLAYERS ?? CACHE_TTL.CLUB_TEAMS;

function getDefaultSeasonDates(season: string) {
    const match = /^(\d{2})--(\d{2})$/.exec(season);

    if (!match) {
        return {
            dateStart: undefined,
            dateEnd: undefined
        };
    }

    const startYear = 2000 + Number(match[1]);
    const endYear = 2000 + Number(match[2]);

    return {
        dateStart: `${startYear}-07-01`,
        dateEnd: `${endYear}-06-30`
    };
}

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

    app.get("/api/clubs/:organization/:clubNumber/players", async (request, reply) => {
        const params = request.params as {
            organization?: string;
            clubNumber?: string;
        };

        const query = request.query as {
            androClubNr?: string;
            andro_club_nr?: string;
            clubName?: string;
            club_name?: string;
        };

        const organization = params.organization?.trim().toUpperCase() ?? "";
        const clubNumber = params.clubNumber?.trim() ?? "";

        const androClubNr =
            query.androClubNr?.trim() || query.andro_club_nr?.trim() || undefined;

        const clubName =
            query.clubName?.trim() || query.club_name?.trim() || undefined;

        if (!organization || !clubNumber) {
            return reply.code(400).send({
                error: {
                    code: "INVALID_INPUT",
                    message: "organization und clubNumber sind erforderlich."
                }
            });
        }

        const cacheKey = [
            "club-players-andro",
            organization,
            clubNumber,
            androClubNr ?? "",
            clubName ?? ""
        ].join(":");

        const cached = getFromCache<ClubPlayersResponse>(cacheKey);

        if (cached) {
            return {
                data: cached,
                meta: {
                    source: "cache"
                }
            };
        }

        try {
            const result = await getClubPlayersFromAndroRanking({
                organization,
                clubNumber,
                androClubNr,
                clubName
            });

            setCache(cacheKey, result, CLUB_PLAYERS_CACHE_TTL);

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

    app.get("/api/clubs/:organization/:clubNumber/schedule", async (request, reply) => {
        const params = request.params as {
            organization?: string;
            clubNumber?: string;
        };

        const query = request.query as {
            season?: string;
            clubSlug?: string;
            dateStart?: string;
            dateEnd?: string;
            date_start?: string;
            date_end?: string;
        };

        const organization = params.organization?.trim().toUpperCase() ?? "";
        const clubNumber = params.clubNumber?.trim() ?? "";
        const season = query.season?.trim() ?? "";
        const clubSlug = query.clubSlug?.trim() || "x";

        if (!organization || !clubNumber || !season) {
            return reply.code(400).send({
                error: {
                    code: "INVALID_INPUT",
                    message: "organization, clubNumber und season sind erforderlich."
                }
            });
        }

        const defaults = getDefaultSeasonDates(season);

        const dateStart =
            query.dateStart?.trim() ||
            query.date_start?.trim() ||
            defaults.dateStart;

        const dateEnd =
            query.dateEnd?.trim() ||
            query.date_end?.trim() ||
            defaults.dateEnd;

        const cacheKey = [
            "club-schedule",
            organization,
            clubNumber,
            season,
            clubSlug,
            dateStart ?? "",
            dateEnd ?? ""
        ].join(":");

        const cached = getFromCache<ClubScheduleResponse>(cacheKey);

        if (cached) {
            return {
                data: cached,
                meta: {
                    source: "cache"
                }
            };
        }

        try {
            const result = await getClubSchedule({
                organization,
                clubNumber,
                season,
                clubSlug,
                dateStart,
                dateEnd
            });

            setCache(cacheKey, result, CLUB_SCHEDULE_CACHE_TTL);

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