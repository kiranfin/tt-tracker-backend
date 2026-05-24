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

export function getOptionalAppUserId(request: FastifyRequest): string | null {
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

export function getRequiredAppUserId(request: FastifyRequest): string {
    const userId = getOptionalAppUserId(request);

    if (!userId) {
        throw new AppUserRequiredError();
    }

    return userId;
}