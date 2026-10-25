import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";

import { searchRoutes } from "./routes/searchRoutes.js";
import { clubRoutes } from "./routes/clubRoutes.js";
import { leagueRoutes } from "./routes/leagueRoutes.js";
import { meetingRoutes } from "./routes/meetingRoutes.js";
import { playerRoutes } from "./routes/playerRoutes.js";
import { teamRoutes } from "./routes/teamRoutes.js";
import { eventRoutes } from "./routes/eventRoutes.js";
import { getRateLimitStatus } from "./rateLimiter.js";
import { flushCacheToDisk, getCacheStatus, initCachePersistence } from "./cache.js";
import { getUpstreamUsage } from "./upstreamTracker.js";
import { requestContext } from "./requestContext.js";
import { writeJsonLog } from "./fileLogger.js";
import { myttSessionRoutes } from "./routes/myttSessionRoutes.js";
import { authRoutes } from "./routes/authRoutes.js";
import { passwordResetRoutes } from "./routes/passwordResetRoutes.js";
import { attachOptionalAppUser } from "./authRequest.js";
import { getRequestContext } from "./requestContext.js";

await initCachePersistence();

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

function getPathname(url: string) {
    return url.split("?")[0] ?? url;
}

function requiresBackendApiKey(url: string) {
    const pathname = getPathname(url);

    return (
        pathname === "/debug/status" ||
        pathname.startsWith("/api/admin/")
    );
}

app.addHook("preHandler", async (request, reply) => {
    if (!requiresBackendApiKey(request.url)) {
        return;
    }

    const expectedApiKey = process.env.TTTRACKER_API_KEY;

    if (!expectedApiKey) {
        return reply.code(503).send({
            error: {
                code: "API_KEY_NOT_CONFIGURED",
                message: "Admin-Zugriff ist nicht konfiguriert."
            }
        });
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

app.addHook("preHandler", async (request, reply) => {
    try {
        const user = await attachOptionalAppUser(request);

        const context = getRequestContext();

        if (context) {
            context.appUserId = user?.id ?? null;
        }
    } catch (error) {
        request.log.error(error);

        return reply.code(401).send({
            error: {
                code: "INVALID_TOKEN",
                message: "Login ist ungültig oder abgelaufen. Bitte erneut einloggen."
            }
        });
    }
});

app.get("/debug/status", async () => {
    return {
        rateLimit: getRateLimitStatus(),
        cache: getCacheStatus(),
        upstream: getUpstreamUsage()
    };
});

await app.register(authRoutes);
await app.register(passwordResetRoutes);
await app.register(searchRoutes);
await app.register(playerRoutes);
await app.register(clubRoutes);
await app.register(leagueRoutes);
await app.register(meetingRoutes);
await app.register(myttSessionRoutes);
await app.register(teamRoutes);
await app.register(eventRoutes);

const port = Number(process.env.PORT ?? 4001);

// Auf dem Server bleibt das Backend hinter dem Reverse Proxy (127.0.0.1).
// Lokal HOST=0.0.0.0 setzen, damit das Handy im WLAN das Backend erreicht.
const host = process.env.HOST?.trim() || "127.0.0.1";

try {
    await app.listen({
        port,
        host
    });

    app.log.info(`Server läuft auf http://${host}:${port}`);

    // Cache vor dem Beenden sichern, damit ein Neustart nicht mit leerem Cache beginnt.
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
        process.once(signal, () => {
            void app
                .close()
                .then(() => flushCacheToDisk())
                .finally(() => process.exit(0));
        });
    }
} catch (error) {
    app.log.error(error);
    process.exit(1);
}