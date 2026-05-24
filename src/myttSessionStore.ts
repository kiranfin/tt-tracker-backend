import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import crypto from "node:crypto";

export type MyttScope = "ttr:read" | "ttr_history:read";

type MyttSessionStatus = "valid" | "expired";

type StoredMyttSession = {
    ownerUserId: string;
    encryptedCookie: string;
    status: MyttSessionStatus;
    createdAt: string;
    updatedAt: string;
    lastVerifiedAt?: string | null;
};

export type MyttGrant = {
    id: string;
    ownerUserId: string;
    granteeUserId: string;
    scopes: MyttScope[];
    expiresAt?: string | null;
    createdAt: string;
    revokedAt?: string | null;
};

type StoreFile = {
    sessions: Record<string, StoredMyttSession>;
    grants: Record<string, MyttGrant>;
};

export type ResolvedMyttSession = {
    mode: "own" | "delegated";
    requesterUserId: string;
    sessionOwnerUserId: string;
    cookie: string;
    grantId?: string;
};

export class MyttAccountRequiredError extends Error {
    constructor() {
        super("No myTischtennis session available for this user");
        this.name = "MyttAccountRequiredError";
    }
}

export class MyttSessionExpiredError extends Error {
    sessionOwnerUserId: string;
    delegated: boolean;

    constructor(params: { sessionOwnerUserId: string; delegated: boolean }) {
        super("myTischtennis session expired");
        this.name = "MyttSessionExpiredError";
        this.sessionOwnerUserId = params.sessionOwnerUserId;
        this.delegated = params.delegated;
    }
}

const STORE_FILE =
    process.env.TTTRACKER_SESSION_STORE_FILE ?? "./data/mytt-sessions.json";

let writeQueue: Promise<void> = Promise.resolve();

function nowIso() {
    return new Date().toISOString();
}

function getSecretKey() {
    const secret = process.env.TTTRACKER_SESSION_SECRET;

    if (!secret || secret.trim().length < 32) {
        throw new Error(
            "TTTRACKER_SESSION_SECRET fehlt oder ist zu kurz. Bitte mindestens 32 Zeichen setzen."
        );
    }

    return crypto.createHash("sha256").update(secret).digest();
}

function encryptText(plainText: string) {
    const key = getSecretKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

    const encrypted = Buffer.concat([
        cipher.update(plainText, "utf8"),
        cipher.final()
    ]);

    const authTag = cipher.getAuthTag();

    return [
        "v1",
        iv.toString("base64"),
        authTag.toString("base64"),
        encrypted.toString("base64")
    ].join(":");
}

function decryptText(encryptedText: string) {
    const [version, ivBase64, authTagBase64, encryptedBase64] =
        encryptedText.split(":");

    if (version !== "v1" || !ivBase64 || !authTagBase64 || !encryptedBase64) {
        throw new Error("Ungültiges verschlüsseltes Cookie-Format.");
    }

    const key = getSecretKey();
    const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(ivBase64, "base64")
    );

    decipher.setAuthTag(Buffer.from(authTagBase64, "base64"));

    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(encryptedBase64, "base64")),
        decipher.final()
    ]);

    return decrypted.toString("utf8");
}

async function readStore(): Promise<StoreFile> {
    try {
        const raw = await readFile(STORE_FILE, "utf8");
        const parsed = JSON.parse(raw) as Partial<StoreFile>;

        return {
            sessions: parsed.sessions ?? {},
            grants: parsed.grants ?? {}
        };
    } catch {
        return {
            sessions: {},
            grants: {}
        };
    }
}

async function writeStore(store: StoreFile) {
    await mkdir(dirname(STORE_FILE), { recursive: true, mode: 0o700 });

    writeQueue = writeQueue.then(() =>
        writeFile(STORE_FILE, JSON.stringify(store, null, 2), {
            mode: 0o600
        })
    );

    await writeQueue;
}

function isGrantActive(grant: MyttGrant, requiredScope: MyttScope) {
    if (grant.revokedAt) {
        return false;
    }

    if (!grant.scopes.includes(requiredScope)) {
        return false;
    }

    if (grant.expiresAt && new Date(grant.expiresAt).getTime() <= Date.now()) {
        return false;
    }

    return true;
}

function assertValidCookieHeader(cookie: string) {
    const trimmed = cookie.trim();

    if (!trimmed || !trimmed.includes("=")) {
        throw new Error("Ungültiger Cookie-Header.");
    }

    if (/[\r\n]/.test(trimmed)) {
        throw new Error("Ungültiger Cookie-Header.");
    }

    return trimmed;
}

export async function setMyttCookieForUser(params: {
    ownerUserId: string;
    cookie: string;
}) {
    const store = await readStore();
    const cookie = assertValidCookieHeader(params.cookie);
    const now = nowIso();

    const existing = store.sessions[params.ownerUserId];

    store.sessions[params.ownerUserId] = {
        ownerUserId: params.ownerUserId,
        encryptedCookie: encryptText(cookie),
        status: "valid",
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        lastVerifiedAt: null
    };

    await writeStore(store);
}

export async function deleteMyttCookieForUser(ownerUserId: string) {
    const store = await readStore();

    delete store.sessions[ownerUserId];

    await writeStore(store);
}

export async function markMyttSessionExpired(ownerUserId: string) {
    const store = await readStore();
    const session = store.sessions[ownerUserId];

    if (!session) {
        return;
    }

    session.status = "expired";
    session.updatedAt = nowIso();

    await writeStore(store);
}

export async function getMyttStatusForUser(userId: string) {
    const store = await readStore();

    const ownSession = store.sessions[userId] ?? null;

    const grantsGiven = Object.values(store.grants).filter(
        (grant) => grant.ownerUserId === userId && !grant.revokedAt
    );

    const grantsReceived = Object.values(store.grants).filter(
        (grant) => grant.granteeUserId === userId && !grant.revokedAt
    );

    return {
        userId,
        ownSession: ownSession
            ? {
                status: ownSession.status,
                createdAt: ownSession.createdAt,
                updatedAt: ownSession.updatedAt,
                lastVerifiedAt: ownSession.lastVerifiedAt ?? null
            }
            : null,
        grantsGiven,
        grantsReceived
    };
}

export async function createMyttGrant(params: {
    ownerUserId: string;
    granteeUserId: string;
    scopes: MyttScope[];
    expiresAt?: string | null;
}) {
    if (params.ownerUserId === params.granteeUserId) {
        throw new Error("Du kannst dir selbst keine Session freigeben.");
    }

    const validScopes: MyttScope[] = ["ttr:read", "ttr_history:read"];

    for (const scope of params.scopes) {
        if (!validScopes.includes(scope)) {
            throw new Error(`Ungültiger Scope: ${scope}`);
        }
    }

    const store = await readStore();
    const id = crypto.randomUUID();
    const now = nowIso();

    const grant: MyttGrant = {
        id,
        ownerUserId: params.ownerUserId,
        granteeUserId: params.granteeUserId,
        scopes: [...new Set(params.scopes)],
        expiresAt: params.expiresAt ?? null,
        createdAt: now,
        revokedAt: null
    };

    store.grants[id] = grant;

    await writeStore(store);

    return grant;
}

export async function revokeMyttGrant(params: {
    ownerUserId: string;
    grantId: string;
}) {
    const store = await readStore();
    const grant = store.grants[params.grantId];

    if (!grant || grant.ownerUserId !== params.ownerUserId) {
        return false;
    }

    grant.revokedAt = nowIso();

    await writeStore(store);

    return true;
}

export async function listMyttGrantsForOwner(ownerUserId: string) {
    const store = await readStore();

    return Object.values(store.grants).filter(
        (grant) => grant.ownerUserId === ownerUserId && !grant.revokedAt
    );
}

export async function resolveMyttSessionForRequest(params: {
    requesterUserId: string;
    requiredScope: MyttScope;
}): Promise<ResolvedMyttSession> {
    const store = await readStore();

    const ownSession = store.sessions[params.requesterUserId];

    if (ownSession?.status === "valid") {
        return {
            mode: "own",
            requesterUserId: params.requesterUserId,
            sessionOwnerUserId: params.requesterUserId,
            cookie: decryptText(ownSession.encryptedCookie)
        };
    }

    const activeGrant = Object.values(store.grants).find((grant) => {
        return (
            grant.granteeUserId === params.requesterUserId &&
            isGrantActive(grant, params.requiredScope)
        );
    });

    if (activeGrant) {
        const ownerSession = store.sessions[activeGrant.ownerUserId];

        if (ownerSession?.status === "valid") {
            return {
                mode: "delegated",
                requesterUserId: params.requesterUserId,
                sessionOwnerUserId: activeGrant.ownerUserId,
                cookie: decryptText(ownerSession.encryptedCookie),
                grantId: activeGrant.id
            };
        }
    }

    throw new MyttAccountRequiredError();
}