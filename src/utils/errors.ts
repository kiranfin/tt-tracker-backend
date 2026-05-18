import type { FastifyReply } from "fastify";
import {
    LocalRateLimitError,
    UpstreamDisabledError,
    UpstreamError,
    UpstreamRateLimitError
} from "../myttClient.js";

export function handleApiError(error: unknown, reply: FastifyReply) {
    if (error instanceof LocalRateLimitError) {
        return reply.code(429).send({
            error: {
                code: "RATE_LIMITED",
                message:
                    "Das eigene Backend hat das gesetzte Anfrage-Limit erreicht. Bitte später erneut versuchen."
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