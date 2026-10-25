import type { FastifyInstance } from "fastify";
import { readThrough } from "../cache/index.js";
import { CACHE_TTL } from "../constants.js";
import { fetchEventsList, fetchEventDetail } from "../dancingParkClient.js";
import { handleApiError } from "../utils/errors.js";
import { buildMeta } from "../utils/responseMeta.js";

// Event ids are GUIDs. Validate before it ever reaches the upstream URL so a
// client can never inject an arbitrary path (SSRF guard).
const GUID_REGEX =
    /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

export async function eventRoutes(app: FastifyInstance) {
    app.get("/api/events", async (request, reply) => {
        try {
            const result = await readThrough({
                key: "events:list",
                ttlMs: CACHE_TTL.EVENTS_LIST,
                load: () => fetchEventsList()
            });

            return {
                data: result.value,
                meta: buildMeta(result)
            };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });

    app.get("/api/events/:id", async (request, reply) => {
        const { id } = request.params as { id: string };

        if (!GUID_REGEX.test(id)) {
            return reply.code(400).send({
                error: {
                    code: "INVALID_INPUT",
                    message: "Ungültige Event-ID."
                }
            });
        }

        try {
            const result = await readThrough({
                key: `events:detail:${id.toLowerCase()}`,
                ttlMs: CACHE_TTL.EVENTS_DETAIL,
                load: () => fetchEventDetail(id)
            });

            return {
                data: result.value,
                meta: buildMeta(result)
            };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });
}
