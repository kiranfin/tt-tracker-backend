import type { FastifyRequest } from "fastify";
import { findAppUserById, type PublicAppUser } from "./authStore.js";
import { InvalidTokenError, verifyAccessToken } from "./authToken.js";

declare module "fastify" {
    interface FastifyRequest {
        appUser?: PublicAppUser | null;
    }
}

export function getBearerToken(request: FastifyRequest) {
    const authorization = request.headers.authorization;

    if (!authorization || !authorization.startsWith("Bearer ")) {
        return null;
    }

    return authorization.slice("Bearer ".length).trim();
}

export async function attachOptionalAppUser(request: FastifyRequest) {
    const token = getBearerToken(request);

    if (!token) {
        request.appUser = null;
        return null;
    }

    const tokenUser = verifyAccessToken(token);
    const user = await findAppUserById(tokenUser.id);

    if (!user) {
        throw new InvalidTokenError();
    }

    request.appUser = user;

    return user;
}