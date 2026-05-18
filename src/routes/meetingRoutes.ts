import type { FastifyInstance } from "fastify";
import { getFromCache, setCache } from "../cache.js";
import { CACHE_TTL } from "../constants.js";
import { getMeetingLive } from "../myttClient.js";
import type { MeetingLiveResponse } from "../schemas.js";
import { handleApiError } from "../utils/errors.js";

export async function meetingRoutes(app: FastifyInstance) {
    app.get("/api/meetings/:meetingId/live", async (request, reply) => {
        const params = request.params as {
            meetingId?: string;
        };

        const meetingId = params.meetingId?.trim() ?? "";

        if (!meetingId) {
            return reply.code(400).send({
                error: {
                    code: "INVALID_INPUT",
                    message: "meetingId ist erforderlich."
                }
            });
        }

        const cacheKey = `meeting-live:${meetingId}`;
        const cached = getFromCache<MeetingLiveResponse>(cacheKey);

        if (cached) {
            return {
                data: cached,
                meta: {
                    source: "cache"
                }
            };
        }

        try {
            const result = await getMeetingLive({
                meetingId
            });

            const isLive = result.data?.live === true;
            const isCompleted = result.data?.is_completed === true;

            const ttlMs = isLive
                ? CACHE_TTL.MEETING_LIVE
                : isCompleted
                    ? CACHE_TTL.MEETING_COMPLETED
                    : CACHE_TTL.MEETING_PLANNED;

            setCache(cacheKey, result, ttlMs);

            return {
                data: result,
                meta: {
                    source: "upstream",
                    cacheTtlMs: ttlMs
                }
            };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });
}