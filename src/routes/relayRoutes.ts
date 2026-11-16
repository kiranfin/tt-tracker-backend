import type { FastifyInstance } from "fastify";
import { AppUserRequiredError } from "../appUser.js";
import { config } from "../config.js";
import { acceptRelayUpload, buildRelayUploader } from "../services/relay.js";
import { handleApiError } from "../utils/errors.js";

export async function relayRoutes(app: FastifyInstance) {
    // Die App lädt Rohantworten von myTischtennis hoch, die das Backend ihr vorher gemeldet hat (Device Relay).
    app.post("/api/relay", { bodyLimit: 6 * 1024 * 1024 }, async (request, reply) => {
        try {
            const userId = request.appUser?.id ?? null;

            if (config.relay.requireAuth && !userId) {
                throw new AppUserRequiredError();
            }

            const { accepted } = acceptRelayUpload(buildRelayUploader(userId, request.ip), request.body);

            return { ok: true, accepted };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });
}
