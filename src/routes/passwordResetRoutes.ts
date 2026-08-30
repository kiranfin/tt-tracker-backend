import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
    EmailAlreadyExistsError,
    findAppUserByEmail,
    setAppUserEmail,
    setAppUserPassword
} from "../authStore.js";
import {
    consumeResetToken,
    createResetToken,
    InvalidResetTokenError
} from "../passwordResetStore.js";
import { sendPasswordResetEmail } from "../mailer.js";
import { allowPasswordResetRequest } from "../passwordResetRateLimit.js";
import { getRequiredAppUserId } from "../appUser.js";
import { handleApiError } from "../utils/errors.js";

const RequestResetBodySchema = z.object({
    email: z.string().email()
});

const ResetPasswordBodySchema = z.object({
    token: z.string().min(1),
    password: z.string().min(8).max(200)
});

const SetEmailBodySchema = z.object({
    email: z.string().email()
});

// Generic response for the request endpoint — identical whether or not the
// email belongs to a user, to prevent account enumeration.
const GENERIC_RESET_RESPONSE = {
    data: {
        ok: true,
        message:
            "Falls ein Konto mit dieser E-Mail existiert, wurde eine E-Mail zum Zurücksetzen verschickt."
    }
};

export async function passwordResetRoutes(app: FastifyInstance) {
    app.post("/api/auth/request-password-reset", async (request, reply) => {
        try {
            const body = RequestResetBodySchema.parse(request.body);
            const email = body.email.trim().toLowerCase();

            if (!allowPasswordResetRequest(email)) {
                return GENERIC_RESET_RESPONSE;
            }

            const user = await findAppUserByEmail(email);

            if (user?.email) {
                const rawToken = await createResetToken(user.id);

                try {
                    await sendPasswordResetEmail(user.email, rawToken);
                } catch (mailError) {
                    // Never surface mail/config failures to the caller — that
                    // would leak whether the email exists. Log for operators.
                    request.log.error(mailError);
                }
            }

            return GENERIC_RESET_RESPONSE;
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });

    app.post("/api/auth/reset-password", async (request, reply) => {
        try {
            const body = ResetPasswordBodySchema.parse(request.body);

            const userId = await consumeResetToken(body.token);
            await setAppUserPassword(userId, body.password);

            return {
                data: {
                    ok: true
                }
            };
        } catch (error) {
            if (error instanceof InvalidResetTokenError) {
                return reply.code(400).send({
                    error: {
                        code: "INVALID_RESET_TOKEN",
                        message:
                            "Der Link ist ungültig oder abgelaufen. Bitte fordere einen neuen an."
                    }
                });
            }

            request.log.error(error);
            return handleApiError(error, reply);
        }
    });

    app.post("/api/auth/email", async (request, reply) => {
        try {
            const userId = getRequiredAppUserId(request);
            const body = SetEmailBodySchema.parse(request.body);

            const user = await setAppUserEmail(userId, body.email);

            return {
                data: {
                    user
                }
            };
        } catch (error) {
            if (error instanceof EmailAlreadyExistsError) {
                return reply.code(409).send({
                    error: {
                        code: "EMAIL_EXISTS",
                        message: "Diese E-Mail-Adresse wird bereits verwendet."
                    }
                });
            }

            request.log.error(error);
            return handleApiError(error, reply);
        }
    });
}
