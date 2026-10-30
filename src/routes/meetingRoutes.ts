import type { FastifyInstance } from "fastify";
import { getMeetingTtlMs, readMeeting } from "../mytt/cachedReads.js";
import { handleApiError } from "../utils/errors.js";
import { buildMeta } from "../utils/responseMeta.js";

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
            const result = await readMeeting(meetingId);

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