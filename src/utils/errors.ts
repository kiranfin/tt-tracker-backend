import type { FastifyReply } from "fastify";
import { LocalHtmlRateLimitError, LocalRateLimitError } from "../rateLimiter.js";
import {
    UpstreamDisabledError,
    UpstreamError,
    UpstreamRateLimitError
} from "../myttClient.js";
import {
    MyttHtmlDisabledError,
    MyttHtmlError,
    MyttHtmlRateLimitError
} from "../myttHtmlReader.js";
import { RemixContextParseError } from "../htmlFallback/remixContext.js";

export function handleApiError(error: unknown, reply: FastifyReply) {
    if (error instanceof LocalHtmlRateLimitError) {
        const retryAfterSeconds = Math.ceil(error.retryAfterMs / 1000);
        const retryAfterMinutes = Math.ceil(retryAfterSeconds / 60);
        const retryAt = new Date(Date.now() + error.retryAfterMs).toISOString();

        reply.header("Retry-After", String(retryAfterSeconds));

        return reply.code(429).send({
            error: {
                code: "HTML_FALLBACK_RATE_LIMITED",
                message:
                    retryAfterMinutes <= 1
                        ? "Das eigene Backend hat das HTML-Fallback-Limit erreicht. Bitte in etwa 1 Minute erneut versuchen."
                        : `Das eigene Backend hat das HTML-Fallback-Limit erreicht. Bitte in etwa ${retryAfterMinutes} Minuten erneut versuchen.`,
                retryAfterSeconds,
                retryAfterMinutes,
                retryAt
            }
        });
    }

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

    if (error instanceof MyttHtmlRateLimitError) {
        return reply.code(429).send({
            error: {
                code: "HTML_FALLBACK_UPSTREAM_RATE_LIMITED",
                message:
                    "myTischtennis ist für HTML-Aufrufe gerade rate-limited. Bitte später erneut versuchen."
            }
        });
    }

    if (error instanceof MyttHtmlDisabledError) {
        return reply.code(503).send({
            error: {
                code: "HTML_FALLBACK_DISABLED",
                message: "HTML-Fallback ist aktuell deaktiviert."
            }
        });
    }

    if (error instanceof MyttHtmlError || error instanceof RemixContextParseError) {
        return reply.code(502).send({
            error: {
                code: "HTML_FALLBACK_ERROR",
                message: error.message
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