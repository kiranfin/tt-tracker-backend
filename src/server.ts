import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";

import { searchRoutes } from "./routes/searchRoutes.js";
import { clubRoutes } from "./routes/clubRoutes.js";
import { leagueRoutes } from "./routes/leagueRoutes.js";
import { meetingRoutes } from "./routes/meetingRoutes.js";
import { playerRoutes } from "./routes/playerRoutes.js";

const app = Fastify({
    logger: true
});

await app.register(cors, {
    origin: true
});

app.get("/health", async () => {
    return {
        ok: true,
        service: "tt-tracker-api"
    };
});

app.addHook("preHandler", async (request, reply) => {
    if (request.url === "/health") {
        return;
    }

    const expectedApiKey = process.env.TTTRACKER_API_KEY;

    if (!expectedApiKey) {
        return;
    }

    const providedApiKey = request.headers["x-api-key"];

    if (providedApiKey !== expectedApiKey) {
        return reply.code(401).send({
            error: {
                code: "UNAUTHORIZED",
                message: "Ungültiger API-Key."
            }
        });
    }
});

await app.register(searchRoutes);
await app.register(playerRoutes);
await app.register(clubRoutes);
await app.register(leagueRoutes);
await app.register(meetingRoutes);

const port = Number(process.env.PORT ?? 4001);

try {
    await app.listen({
        port,
        host: "127.0.0.1"
    });

    app.log.info(`Server läuft auf http://127.0.0.1:${port}`);
} catch (error) {
    app.log.error(error);
    process.exit(1);
}