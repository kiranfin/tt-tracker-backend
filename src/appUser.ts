import type { FastifyRequest } from "fastify";

export class AppUserRequiredError extends Error {
    constructor() {
        super("App user required");
        this.name = "AppUserRequiredError";
    }
}

export class InvalidAppUserError extends Error {
    constructor() {
        super("Invalid app user id");
        this.name = "InvalidAppUserError";
    }
}

function normalizeAppUserId(value: string) {
    return value.trim().toLowerCase();
}

function isValidAppUserId(value: string) {
    return /^[a-z0-9._-]{2,64}$/.test(value);
}

function getDevHeaderUserId(request: FastifyRequest): string | null {
    if (process.env.TTTRACKER_DEV_USER_HEADER_ENABLED !== "true") {
        return null;
    }

    const header = request.headers["x-tt-user-id"];

    const raw =
        typeof header === "string"
            ? header
            : Array.isArray(header)
                ? header[0]
                : null;

    if (!raw) {
        return null;
    }

    const userId = normalizeAppUserId(raw);

    if (!isValidAppUserId(userId)) {
        throw new InvalidAppUserError();
    }

    return userId;
}

export function getOptionalAppUserId(request: FastifyRequest): string | null {
    if (request.appUser?.id) {
        return request.appUser.id;
    }

    return getDevHeaderUserId(request);
}

export function getRequiredAppUserId(request: FastifyRequest): string {
    const userId = getOptionalAppUserId(request);

    if (!userId) {
        throw new AppUserRequiredError();
    }

    return userId;
}