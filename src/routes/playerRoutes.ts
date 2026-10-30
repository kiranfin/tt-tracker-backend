import type { FastifyInstance, FastifyReply } from "fastify";
import { getRequiredAppUserId } from "../appUser.js";
import { config } from "../config.js";
import { getPlayerTtrEstimate } from "../services/estimate.js";
import {
    comparePlayers,
    getHeadToHead,
    getPersonalTtr,
    getPersonalTtrHistory
} from "../services/personalTtr.js";
import { getPublicPlayerRating } from "../services/rating.js";
import { handleApiError, sendInvalidInput } from "../utils/errors.js";
import { normalizeNuid, toHeadToHeadOtherUser } from "../utils/nuid.js";

function isValidNuid(nuid: string) {
    return nuid.length >= 3;
}

type PublicPlayerQuery = {
    organization?: string;
    clubNumber?: string;
    clubName?: string;
    name?: string;
};

/**
 * Eingaben der öffentlichen Spieler Routen (rating, ttr-estimate): Verein per organization und
 * clubNumber oder, wenn er fehlt, über den Namen des Spielers. Antwortet bei Fehlern selbst.
 */
function parsePublicPlayerRequest(
    rawNuid: string,
    query: PublicPlayerQuery,
    reply: FastifyReply
) {
    const nuid = normalizeNuid(rawNuid);
    const organization = query.organization?.trim().toUpperCase() ?? "";
    const clubNumber = query.clubNumber?.trim() ?? "";
    const clubName = query.clubName?.trim() || undefined;
    const name = query.name?.trim() || undefined;

    if (!isValidNuid(nuid)) {
        sendInvalidInput(reply, "Ungültige Spieler-ID.");
        return null;
    }

    if ((!organization || !clubNumber) && !name) {
        sendInvalidInput(reply, "organization und clubNumber oder name sind erforderlich.");
        return null;
    }

    return { nuid, organization, clubNumber, clubName, name };
}

export async function playerRoutes(app: FastifyInstance) {
    // Öffentlicher TTR aus der Andro Rangliste des Vereins, ohne myTischtennis Login.
    app.get("/api/players/:nuid/rating", async (request, reply) => {
        try {
            const { nuid } = request.params as { nuid: string };
            const input = parsePublicPlayerRequest(nuid, request.query as PublicPlayerQuery, reply);

            if (!input) {
                return reply;
            }

            const { value, meta } = await getPublicPlayerRating({
                nuid: input.nuid,
                name: input.name ?? "",
                organization: input.organization,
                clubNumber: input.clubNumber,
                clubName: input.clubName
            });

            return { data: value, meta };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });

    app.get("/api/players/:nuid/ttr", async (request, reply) => {
        try {
            const requestingUserId = getRequiredAppUserId(request);

            const { nuid: rawNuid } = request.params as { nuid: string };
            const nuid = normalizeNuid(rawNuid);

            if (!isValidNuid(nuid)) {
                return sendInvalidInput(reply, "Ungültige Spieler-ID.");
            }

            const { value, meta } = await getPersonalTtr(requestingUserId, nuid);

            return { data: value, meta };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });

    // Geschätzter TTR und Verlauf aus öffentlichen Spielberichten, ohne myTischtennis Login.
    app.get("/api/players/:nuid/ttr-estimate", async (request, reply) => {
        // Ein kalter Lauf erzeugt dutzende myTT Requests, deshalb vorerst abgeschaltet.
        if (!config.features.ttrEstimate) {
            return reply.code(404).send({
                error: {
                    code: "FEATURE_DISABLED",
                    message: "Die TTR-Schätzung ist derzeit deaktiviert."
                }
            });
        }

        try {
            const { nuid } = request.params as { nuid: string };
            const input = parsePublicPlayerRequest(nuid, request.query as PublicPlayerQuery, reply);

            if (!input) {
                return reply;
            }

            const { value, meta } = await getPlayerTtrEstimate(input);

            return { data: value, meta };
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

            if (!isValidNuid(nuid)) {
                return sendInvalidInput(reply, "Ungültige Spieler-ID.");
            }

            const { value, meta } = await getPersonalTtrHistory(requestingUserId, nuid);

            return { data: value, meta };
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

            if (!isValidNuid(otherUser)) {
                return sendInvalidInput(reply, "Ungültige Gegner-ID.");
            }

            const { value, meta } = await getHeadToHead(requestingUserId, nuid, otherUser);

            return { data: value, meta };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });

    app.get("/api/players/:leftNuid/compare/:rightNuid", async (request, reply) => {
        try {
            const requestingUserId = getRequiredAppUserId(request);

            const { leftNuid: rawLeftNuid, rightNuid: rawRightNuid } = request.params as {
                leftNuid: string;
                rightNuid: string;
            };

            const leftNuid = normalizeNuid(rawLeftNuid);
            const rightNuid = normalizeNuid(rawRightNuid);

            if (!isValidNuid(leftNuid)) {
                return sendInvalidInput(reply, "Ungültige erste Spieler-ID.");
            }

            if (!isValidNuid(rightNuid)) {
                return sendInvalidInput(reply, "Ungültige zweite Spieler-ID.");
            }

            if (leftNuid === rightNuid) {
                return sendInvalidInput(reply, "Bitte zwei unterschiedliche Spieler auswählen.");
            }

            const { value, meta } = await comparePlayers(
                requestingUserId,
                leftNuid,
                rightNuid,
                (info, message) => request.log.warn(info, message)
            );

            return { data: value, meta };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });
}
