import type { FastifyInstance } from "fastify";
import { runCanary } from "../canary/runCanary.js";
import { handleApiError } from "../utils/errors.js";

// Geschützt durch den x-api-key Hook in server.ts (alles unter /api/admin/).
export async function adminRoutes(app: FastifyInstance) {
    app.post("/api/admin/canary/run", async (request, reply) => {
        try {
            return await runCanary();
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });
}
