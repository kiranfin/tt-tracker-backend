import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";

import { searchRoutes } from "./routes/searchRoutes.js";
import { clubRoutes } from "./routes/clubRoutes.js";
import { leagueRoutes } from "./routes/leagueRoutes.js";
import { meetingRoutes } from "./routes/meetingRoutes.js";
import { playerRoutes } from "./routes/playerRoutes.js";
import { getRateLimitStatus } from "./rateLimiter.js";
import { getUpstreamUsage } from "./upstreamTracker.js";
import { requestContext } from "./requestContext.js";
import { writeJsonLog } from "./fileLogger.js";
import { myttSessionRoutes } from "./routes/myttSessionRoutes.js";

const app = Fastify({
    logger: true,
    trustProxy: true
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

app.addHook("onRequest", (request, reply, done) => {
    const rawAppUserId = request.headers["x-tt-user-id"];
    const appUserId =
        typeof rawAppUserId === "string"
            ? rawAppUserId.trim().toLowerCase()
            : null;

    const context = {
        requestId: request.id,
        method: request.method,
        url: request.url,
        ip: request.ip,
        userAgent: request.headers["user-agent"],
        appUserId
    };

    requestContext.run(context, () => {
        void writeJsonLog("backend_request", {
            requestId: context.requestId,
            method: context.method,
            url: context.url,
            ip: context.ip,
            userAgent: context.userAgent,
            appUserId: context.appUserId
        });

        done();
    });
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

app.get("/debug/status", async () => {
    return {
        rateLimit: getRateLimitStatus(),
        upstream: getUpstreamUsage()
    };
});

await app.register(searchRoutes);
await app.register(playerRoutes);
await app.register(clubRoutes);
await app.register(leagueRoutes);
await app.register(meetingRoutes);
await app.register(myttSessionRoutes);

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