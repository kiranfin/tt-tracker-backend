import type { FastifyInstance } from "fastify";
import { readThrough } from "../cache/index.js";
import { CACHE_TTL } from "../constants.js";
import { getMeetingLive } from "../mytt/index.js";
import type { MeetingLiveResponse } from "../schemas.js";
import { handleApiError } from "../utils/errors.js";
import { buildMeta } from "../utils/responseMeta.js";

function getMeetingTtlMs(result: MeetingLiveResponse) {
    if (result.data?.live === true) {
        return CACHE_TTL.MEETING_LIVE;
    }

    return result.data?.is_completed === true
        ? CACHE_TTL.MEETING_COMPLETED
        : CACHE_TTL.MEETING_PLANNED;
}

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

        try {
            const result = await readThrough({
                key: `meeting-live:${meetingId}`,
                ttlMs: getMeetingTtlMs,
                load: () =>
                    getMeetingLive({
                        meetingId
                    })
            });

            return {
                data: result.value,
                meta: buildMeta(result, {
                    cacheTtlMs: getMeetingTtlMs(result.value)
                })
            };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });
}