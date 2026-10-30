import type { FastifyInstance } from "fastify";
import { getEventDetail, getEventList } from "../services/events.js";
import { handleApiError, sendInvalidInput } from "../utils/errors.js";

// Event ids are GUIDs. Validate before it ever reaches the upstream URL so a
// client can never inject an arbitrary path (SSRF guard).
const GUID_REGEX =
    /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

export async function eventRoutes(app: FastifyInstance) {
    app.get("/api/events", async (request, reply) => {
        try {
            const { value, meta } = await getEventList();

            return { data: value, meta };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });

    app.get("/api/events/:id", async (request, reply) => {
        const { id } = request.params as { id: string };

        if (!GUID_REGEX.test(id)) {
            return sendInvalidInput(reply, "Ungültige Event-ID.");
        }

        try {
            const { value, meta } = await getEventDetail(id);

            return { data: value, meta };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });
}
