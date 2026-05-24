import crypto from "node:crypto";

export type AuthenticatedAppUser = {
    id: string;
    username: string;
};

type TokenPayload = {
    sub: string;
    username: string;
    iat: number;
    exp: number;
};

export class InvalidTokenError extends Error {
    constructor() {
        super("Invalid token");
        this.name = "InvalidTokenError";
    }
}

function getAuthSecret() {
    const secret = process.env.TTTRACKER_AUTH_SECRET;

    if (!secret || secret.trim().length < 32) {
        throw new Error(
            "TTTRACKER_AUTH_SECRET fehlt oder ist zu kurz. Bitte mindestens 32 Zeichen setzen."
        );
    }

    return secret;
}

function base64url(input: Buffer | string) {
    return Buffer.from(input)
        .toString("base64")
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replaceAll("=", "");
}

function parseBase64url(input: string) {
    const normalized = input.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(
        normalized.length + ((4 - (normalized.length % 4)) % 4),
        "="
    );

    return Buffer.from(padded, "base64").toString("utf8");
}

function sign(data: string) {
    return base64url(
        crypto.createHmac("sha256", getAuthSecret()).update(data).digest()
    );
}

export function createAccessToken(user: AuthenticatedAppUser) {
    const nowSeconds = Math.floor(Date.now() / 1000);

    const header = {
        alg: "HS256",
        typ: "JWT"
    };

    const payload: TokenPayload = {
        sub: user.id,
        username: user.username,
        iat: nowSeconds,
        exp: nowSeconds + 60 * 60 * 24 * 30
    };

    const encodedHeader = base64url(JSON.stringify(header));
    const encodedPayload = base64url(JSON.stringify(payload));
    const unsignedToken = `${encodedHeader}.${encodedPayload}`;
    const signature = sign(unsignedToken);

    return `${unsignedToken}.${signature}`;
}

export function verifyAccessToken(token: string): AuthenticatedAppUser {
    const parts = token.split(".");

    if (parts.length !== 3) {
        throw new InvalidTokenError();
    }

    const [encodedHeader, encodedPayload, signature] = parts;
    const unsignedToken = `${encodedHeader}.${encodedPayload}`;
    const expectedSignature = sign(unsignedToken);

    const a = Buffer.from(signature);
    const b = Buffer.from(expectedSignature);

    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        throw new InvalidTokenError();
    }

    let payload: TokenPayload;

    try {
        payload = JSON.parse(parseBase64url(encodedPayload)) as TokenPayload;
    } catch {
        throw new InvalidTokenError();
    }

    if (!payload.sub || !payload.username || !payload.exp) {
        throw new InvalidTokenError();
    }

    if (payload.exp <= Math.floor(Date.now() / 1000)) {
        throw new InvalidTokenError();
    }

    return {
        id: payload.sub,
        username: payload.username
    };
}