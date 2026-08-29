import type { FastifyInstance } from "fastify";
import { getFromCache, setCache } from "../cache.js";
import { CACHE_TTL } from "../constants.js";
import { fetchEventsList, fetchEventDetail } from "../dancingParkClient.js";
import type { EventDetail, EventListResponse } from "../schemas.js";
import { handleApiError } from "../utils/errors.js";

// Event ids are GUIDs. Validate before it ever reaches the upstream URL so a
// client can never inject an arbitrary path (SSRF guard).
const GUID_REGEX =
    /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/;

export async function eventRoutes(app: FastifyInstance) {
    app.get("/api/events", async (request, reply) => {
        const cacheKey = "events:list";
        const cached = getFromCache<EventListResponse>(cacheKey);

        if (cached) {
            return {
                data: cached,
                meta: {
                    source: "cache"
                }
            };
        }

        try {
            const result = await fetchEventsList();

            setCache(cacheKey, result, CACHE_TTL.EVENTS_LIST);

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

        const cacheKey = `events:detail:${id.toLowerCase()}`;
        const cached = getFromCache<EventDetail>(cacheKey);

        if (cached) {
            return {
                data: cached,
                meta: {
                    source: "cache"
                }
            };
        }

        try {
            const result = await fetchEventDetail(id);

            setCache(cacheKey, result, CACHE_TTL.EVENTS_DETAIL);

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
