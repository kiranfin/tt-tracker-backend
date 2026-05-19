import type { FastifyInstance } from "fastify";
import { getFromCache, setCache } from "../cache.js";
import { CACHE_TTL } from "../constants.js";
import { getPlayerTtr, getPlayerTtrHistory } from "../myttClient.js";
import type {
    PlayerTtrHistoryResponse,
    PlayerTtrResponse
} from "../schemas.js";
import { handleApiError } from "../utils/errors.js";

function normalizeNuid(nuid: string) {
    return nuid.trim().toUpperCase();
}

function hasAuthError(response: { error?: unknown | null }) {
    return response.error !== null && response.error !== undefined;
}

export async function playerRoutes(app: FastifyInstance) {
    app.get("/api/players/:nuid/ttr", async (request, reply) => {
        const { nuid: rawNuid } = request.params as { nuid: string };
        const nuid = normalizeNuid(rawNuid);

        if (!nuid || nuid.length < 3) {
            return reply.code(400).send({
                error: {
                    code: "INVALID_INPUT",
                    message: "Ungültige Spieler-ID."
                }
            });
        }

        const cacheKey = `player-ttr:${nuid}`;
        const cached = getFromCache<PlayerTtrResponse>(cacheKey);

        if (cached) {
            return {
                data: {
                    nuid,
                    available: !hasAuthError(cached) && cached.ttr != null,
                    ttr: cached.ttr ?? null,
                    error: cached.error ?? null
                },
                meta: {
                    source: "cache"
                }
            };
        }

        try {
            const result = await getPlayerTtr({ nuid });

            setCache(cacheKey, result, CACHE_TTL.PLAYER_TTR);

            return {
                data: {
                    nuid,
                    available: !hasAuthError(result) && result.ttr != null,
                    ttr: result.ttr ?? null,
                    error: result.error ?? null
                },
                meta: {
                    source: "upstream"
                }
            };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });

    app.get("/api/players/:nuid/ttr-history", async (request, reply) => {
        const { nuid: rawNuid } = request.params as { nuid: string };
        const nuid = normalizeNuid(rawNuid);

        if (!nuid || nuid.length < 3) {
            return reply.code(400).send({
                error: {
                    code: "INVALID_INPUT",
                    message: "Ungültige Spieler-ID."
                }
            });
        }

        const cacheKey = `player-ttr-history:${nuid}`;
        const cached = getFromCache<PlayerTtrHistoryResponse>(cacheKey);

        if (cached) {
            return {
                data: {
                    nuid,
                    available: !hasAuthError(cached),
                    ttr: cached.ttr ?? null,
                    qttr: cached.vq_ttr ?? null,
                    maxTtr: cached.max_ttr ?? null,
                    ttrDate: cached.ttr_date ?? null,
                    maxTtrDate: cached.max_ttr_date ?? null,
                    clubName: cached.club_name ?? null,
                    personName: cached.person_name ?? null,
                    events: cached.event ?? [],
                    error: cached.error ?? null
                },
                meta: {
                    source: "cache"
                }
            };
        }

        try {
            const result = await getPlayerTtrHistory({ nuid });

            setCache(cacheKey, result, CACHE_TTL.PLAYER_TTR_HISTORY);

            return {
                data: {
                    nuid,
                    available: !hasAuthError(result),
                    ttr: result.ttr ?? null,
                    qttr: result.vq_ttr ?? null,
                    maxTtr: result.max_ttr ?? null,
                    ttrDate: result.ttr_date ?? null,
                    maxTtrDate: result.max_ttr_date ?? null,
                    clubName: result.club_name ?? null,
                    personName: result.person_name ?? null,
                    events: result.event ?? [],
                    error: result.error ?? null
                },
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