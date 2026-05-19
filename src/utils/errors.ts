import type { FastifyReply } from "fastify";
import { LocalRateLimitError } from "../rateLimiter.js";
import {
    UpstreamDisabledError,
    UpstreamError,
    UpstreamRateLimitError
} from "../myttClient.js";

export function handleApiError(error: unknown, reply: FastifyReply) {
    if (error instanceof LocalRateLimitError) {
        const retryAfterSeconds = Math.ceil(error.retryAfterMs / 1000);
        const retryAfterMinutes = Math.ceil(retryAfterSeconds / 60);
        const retryAt = new Date(Date.now() + error.retryAfterMs).toISOString();

        reply.header("Retry-After", String(retryAfterSeconds));

        return reply.code(429).send({
            error: {
                code: "RATE_LIMITED",
                message:
                    retryAfterMinutes <= 1
                        ? "Das eigene Backend hat das gesetzte Anfrage-Limit erreicht. Bitte in etwa 1 Minute erneut versuchen."
                        : `Das eigene Backend hat das gesetzte Anfrage-Limit erreicht. Bitte in etwa ${retryAfterMinutes} Minuten erneut versuchen.`,
                retryAfterSeconds,
                retryAfterMinutes,
                retryAt
            }
        });
    }

    if (error instanceof UpstreamRateLimitError) {
        return reply.code(429).send({
            error: {
                code: "RATE_LIMITED",
                message:
                    "myTischtennis ist gerade rate-limited. Bitte später erneut versuchen."
            }
        });
    }

    if (error instanceof UpstreamDisabledError) {
        return reply.code(503).send({
            error: {
                code: "UPSTREAM_DISABLED",
                message: "Externe Datenquelle ist aktuell deaktiviert."
            }
        });
    }

    if (error instanceof UpstreamError) {
        return reply.code(502).send({
            error: {
                code: "UPSTREAM_ERROR",
                message: error.message
            }
        });
    }

    return reply.code(500).send({
        error: {
            code: "INTERNAL_ERROR",
            message: "Unerwarteter Serverfehler."
        }
    });
}