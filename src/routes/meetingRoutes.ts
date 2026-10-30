import type { FastifyInstance } from "fastify";
import { getMeeting } from "../services/meeting.js";
import { handleApiError, sendInvalidInput } from "../utils/errors.js";

export async function meetingRoutes(app: FastifyInstance) {
    app.get("/api/meetings/:meetingId/live", async (request, reply) => {
        const params = request.params as {
            meetingId?: string;
        };

        const meetingId = params.meetingId?.trim() ?? "";

        if (!meetingId) {
            return sendInvalidInput(reply, "meetingId ist erforderlich.");
        }

        try {
            const { value, meta } = await getMeeting(meetingId);

            return { data: value, meta };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });
}
