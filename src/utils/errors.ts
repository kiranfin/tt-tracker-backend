import type { FastifyReply } from "fastify";
import { ZodError } from "zod";
import { AppUserRequiredError, InvalidAppUserError } from "../appUser.js";
import { LocalRateLimitError } from "../rateLimiter.js";
import {
    MyttAccountRequiredError,
    MyttSessionExpiredError
} from "../myttSessionStore.js";
import {
    UpstreamDisabledError,
    UpstreamError,
    UpstreamRateLimitError
} from "../myttClient.js";

export function handleApiError(error: unknown, reply: FastifyReply) {
    if (error instanceof ZodError) {
        return reply.code(400).send({
            error: {
                code: "INVALID_INPUT",
                message: "Ungültige Eingabe.",
                details: error.flatten()
            }
        });
    }

    if (error instanceof AppUserRequiredError) {
        return reply.code(401).send({
            error: {
                code: "APP_USER_REQUIRED",
                message:
                    "Für diese Funktion muss ein App-User angegeben werden."
            }
        });
    }

    if (error instanceof InvalidAppUserError) {
        return reply.code(400).send({
            error: {
                code: "INVALID_APP_USER",
                message: "Ungültige App-User-ID."
            }
        });
    }

    if (error instanceof MyttAccountRequiredError) {
        return reply.code(403).send({
            error: {
                code: "MYTT_ACCOUNT_REQUIRED",
                message:
                    "Für diese Funktion ist eine eigene oder freigegebene myTischtennis-Session nötig."
            }
        });
    }

    if (error instanceof MyttSessionExpiredError) {
        return reply.code(401).send({
            error: {
                code: error.delegated
                    ? "MYTT_SHARED_SESSION_EXPIRED"
                    : "MYTT_AUTH_EXPIRED",
                message: error.delegated
                    ? "Die freigegebene myTischtennis-Session ist abgelaufen."
                    : "Deine myTischtennis-Session ist abgelaufen. Bitte Cookie erneuern."
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