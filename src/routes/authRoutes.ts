import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createAccessToken } from "../authToken.js";
import {
    createAppUser,
    InvalidCredentialsError,
    UsernameAlreadyExistsError,
    verifyAppUserLogin
} from "../authStore.js";
import { getRequiredAppUserId } from "../appUser.js";
import { handleApiError } from "../utils/errors.js";

const AuthBodySchema = z.object({
    username: z.string().min(2).max(32),
    password: z.string().min(8).max(200)
});

export async function authRoutes(app: FastifyInstance) {
    app.post("/api/auth/register", async (request, reply) => {
        try {
            const body = AuthBodySchema.parse(request.body);

            const user = await createAppUser({
                username: body.username,
                password: body.password
            });

            const accessToken = createAccessToken(user);

            return {
                data: {
                    user,
                    accessToken
                }
            };
        } catch (error) {
            if (error instanceof UsernameAlreadyExistsError) {
                return reply.code(409).send({
                    error: {
                        code: "USERNAME_EXISTS",
                        message: "Dieser Benutzername ist bereits vergeben."
                    }
                });
            }

            request.log.error(error);
            return handleApiError(error, reply);
        }
    });

    app.post("/api/auth/login", async (request, reply) => {
        try {
            const body = AuthBodySchema.parse(request.body);

            const user = await verifyAppUserLogin({
                username: body.username,
                password: body.password
            });

            const accessToken = createAccessToken(user);

            return {
                data: {
                    user,
                    accessToken
                }
            };
        } catch (error) {
            if (error instanceof InvalidCredentialsError) {
                return reply.code(401).send({
                    error: {
                        code: "INVALID_CREDENTIALS",
                        message: "Benutzername oder Passwort ist falsch."
                    }
                });
            }

            request.log.error(error);
            return handleApiError(error, reply);
        }
    });

    app.get("/api/auth/me", async (request, reply) => {
        try {
            const userId = getRequiredAppUserId(request);

            return {
                data: {
                    user: request.appUser ?? {
                        id: userId,
                        username: userId
                    }
                }
            };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });
}