import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getRequiredAppUserId } from "../appUser.js";
import { findAppUserById, findAppUserByUsername } from "../authStore.js";
import {
    createMyttGrant,
    deleteMyttCookieForUser,
    getMyttStatusForUser,
    listMyttGrantsForOwner,
    revokeMyttGrant,
    setMyttCookieForUser
} from "../myttSessionStore.js";
import { handleApiError } from "../utils/errors.js";

const CookieBodySchema = z.object({
    cookie: z.string().min(5)
});

const GrantBodySchema = z
    .object({
        granteeUsername: z.string().min(2).max(32).optional(),
        granteeUserId: z.string().min(2).max(64).optional(),
        scopes: z.array(z.enum(["ttr:read", "ttr_history:read"])).min(1),
        expiresAt: z.string().datetime().nullable().optional()
    })
    .refine(
        (body) => Boolean(body.granteeUsername) !== Boolean(body.granteeUserId),
        {
            path: ["granteeUsername"],
            message:
                "Bitte entweder granteeUsername oder granteeUserId angeben, aber nicht beides."
        }
    );

export async function myttSessionRoutes(app: FastifyInstance) {
    app.get("/api/me/mytt/status", async (request, reply) => {
        try {
            const userId = getRequiredAppUserId(request);
            return await getMyttStatusForUser(userId);
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });

    app.put("/api/me/mytt/cookie", async (request, reply) => {
        try {
            const userId = getRequiredAppUserId(request);
            const body = CookieBodySchema.parse(request.body);

            await setMyttCookieForUser({
                ownerUserId: userId,
                cookie: body.cookie
            });

            return {
                ok: true
            };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });

    app.delete("/api/me/mytt/cookie", async (request, reply) => {
        try {
            const userId = getRequiredAppUserId(request);

            await deleteMyttCookieForUser(userId);

            return {
                ok: true
            };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });

    app.get("/api/me/mytt/grants", async (request, reply) => {
        try {
            const userId = getRequiredAppUserId(request);

            return {
                data: await listMyttGrantsForOwner(userId)
            };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });

    app.post("/api/me/mytt/grants", async (request, reply) => {
        try {
            const ownerUserId = getRequiredAppUserId(request);
            const body = GrantBodySchema.parse(request.body);

            const grantee = body.granteeUsername
                ? await findAppUserByUsername(body.granteeUsername)
                : await findAppUserById(body.granteeUserId!);

            if (!grantee) {
                return reply.code(404).send({
                    error: {
                        code: "USER_NOT_FOUND",
                        message: "Benutzer für diese Freigabe nicht gefunden."
                    }
                });
            }

            if (grantee.id === ownerUserId) {
                return reply.code(400).send({
                    error: {
                        code: "SELF_GRANT_NOT_ALLOWED",
                        message:
                            "Du kannst dir selbst keine myTischtennis-Session freigeben."
                    }
                });
            }

            const grant = await createMyttGrant({
                ownerUserId,
                granteeUserId: grantee.id,
                scopes: body.scopes,
                expiresAt: body.expiresAt ?? null
            });

            return {
                data: {
                    ...grant,
                    granteeUsername: grantee.username
                }
            };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });

    app.delete("/api/me/mytt/grants/:grantId", async (request, reply) => {
        try {
            const ownerUserId = getRequiredAppUserId(request);
            const { grantId } = request.params as { grantId: string };

            const revoked = await revokeMyttGrant({
                ownerUserId,
                grantId
            });

            if (!revoked) {
                return reply.code(404).send({
                    error: {
                        code: "NOT_FOUND",
                        message: "Freigabe nicht gefunden."
                    }
                });
            }

            return {
                ok: true
            };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });
}