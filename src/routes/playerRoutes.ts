import type { FastifyInstance } from "fastify";
import { getRequiredAppUserId } from "../appUser.js";
import {
    getPlayerHeadToHead,
    getPlayerTtr,
    getPlayerTtrHistory
} from "../myttClient.js";
import { handleApiError } from "../utils/errors.js";

function normalizeNuid(nuid: string) {
    return nuid.trim().toUpperCase();
}

function toHeadToHeadOtherUser(nuid: string) {
    const normalized = normalizeNuid(nuid);

    if (normalized.startsWith("NU")) {
        return normalized.slice(2);
    }

    return normalized;
}

function hasAuthError(response: { error?: unknown | null }) {
    return response.error !== null && response.error !== undefined;
}

export async function playerRoutes(app: FastifyInstance) {
    app.get("/api/players/:nuid/ttr", async (request, reply) => {
        try {
            const requestingUserId = getRequiredAppUserId(request);

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

            const result = await getPlayerTtr({
                requestingUserId,
                nuid
            });

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
        try {
            const requestingUserId = getRequiredAppUserId(request);

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

            const result = await getPlayerTtrHistory({
                requestingUserId,
                nuid
            });

            return {
                data: {
                    nuid,
                    available: !hasAuthError(result),
                    ttr: result.ttr ?? null,
                    qttr: result.vq_ttr ?? Number(result.ttr_last_fixed) ?? null,
                    qttrDate: result.ttr_last_fixed_date ?? null,
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

    app.get("/api/players/:nuid/head-to-head", async (request, reply) => {
        try {
            const requestingUserId = getRequiredAppUserId(request);

            const { nuid: rawNuid } = request.params as { nuid: string };
            const nuid = normalizeNuid(rawNuid);
            const otherUser = toHeadToHeadOtherUser(nuid);

            if (!otherUser || otherUser.length < 3) {
                return reply.code(400).send({
                    error: {
                        code: "INVALID_INPUT",
                        message: "Ungültige Gegner-ID."
                    }
                });
            }

            const result = await getPlayerHeadToHead({
                requestingUserId,
                otherUser
            });

            return {
                data: {
                    nuid,
                    otherUser,
                    available: !hasAuthError(result),
                    items: Array.isArray(result.data) ? result.data : [],
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