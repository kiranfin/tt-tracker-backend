import type { FastifyInstance } from "fastify";
import { getRequiredAppUserId } from "../appUser.js";
import {
    getSharedPlayer,
    removeOwnSnapshot,
    SnapshotBodySchema,
    uploadSnapshot
} from "../services/snapshots.js";
import { handleApiError, sendInvalidInput } from "../utils/errors.js";
import { normalizeNuid } from "../utils/nuid.js";

export async function snapshotRoutes(app: FastifyInstance) {
    // Das Handy lädt den eigenen TTR und Verlauf hoch, solange der Nutzer teilt. Höchstens einmal pro Stunde.
    app.put("/api/me/mytt/snapshots", async (request, reply) => {
        try {
            const userId = getRequiredAppUserId(request);
            const body = SnapshotBodySchema.parse(request.body);

            uploadSnapshot(userId, body);

            return { ok: true };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });

    app.delete("/api/me/mytt/snapshots", async (request, reply) => {
        try {
            removeOwnSnapshot(getRequiredAppUserId(request));

            return { ok: true };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });

    // Snapshot eines Spielers, den jemand mit dem anfragenden Nutzer teilt.
    app.get("/api/shared/players/:nuid", async (request, reply) => {
        try {
            const requesterUserId = getRequiredAppUserId(request);
            const { nuid: rawNuid } = request.params as { nuid: string };
            const nuid = normalizeNuid(rawNuid);

            if (nuid.length < 3) {
                return sendInvalidInput(reply, "Ungültige Spieler-ID.");
            }

            const { value, meta } = await getSharedPlayer(requesterUserId, nuid);

            return { data: value, meta };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });
}
