import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import crypto from "node:crypto";

import {
    getGrant,
    importLegacyGrants,
    insertGrant,
    isGrantActive,
    isGrantLive,
    listGrantsByGrantee,
    listGrantsByOwner,
    markGrantRevoked,
    type MyttGrant,
    type MyttScope
} from "./store/grantStore.js";
import { deleteSnapshot } from "./store/snapshotStore.js";

export type { MyttGrant, MyttScope };

type MyttSessionStatus = "valid" | "expired";

type StoredMyttSession = {
    ownerUserId: string;
    encryptedCookie: string;
    status: MyttSessionStatus;
    createdAt: string;
    updatedAt: string;
    lastVerifiedAt?: string | null;
};

// Die Freigaben liegen in der Ablage (SQLite). Hier stehen nur noch die Sessions der Altversion, und
// Freigaben aus der alten Datei, bis sie in die Ablage übernommen sind.
type StoreFile = {
    sessions: Record<string, StoredMyttSession>;
    legacyGrants?: Record<string, MyttGrant>;
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
    let parsed: { sessions?: Record<string, StoredMyttSession>; grants?: Record<string, MyttGrant> } = {};

    try {
        parsed = JSON.parse(await readFile(STORE_FILE, "utf8"));
    } catch {
        parsed = {};
    }

    const store: StoreFile = { sessions: parsed.sessions ?? {} };
    const legacy = Object.values(parsed.grants ?? {});

    if (legacy.length > 0) {
        try {
            importLegacyGrants(legacy);
        } catch {
            // Ohne Ablage bleiben die Freigaben in der Datei, bis sie sich übernehmen lassen.
            store.legacyGrants = parsed.grants;
        }
    }

    return store;
}

async function writeStore(store: StoreFile) {
    await mkdir(dirname(STORE_FILE), { recursive: true, mode: 0o700 });

    const content = JSON.stringify(
        { sessions: store.sessions, ...(store.legacyGrants ? { grants: store.legacyGrants } : {}) },
        null,
        2
    );

    writeQueue = writeQueue.then(() => writeFile(STORE_FILE, content, { mode: 0o600 }));

    await writeQueue;
}

/**
 * Der Cookie liegt nur auf dem Server, solange der Besitzer teilt. Ohne lebende Freigabe wird er gelöscht:
 * sofort nach dem Widerruf, bei Ablauf beim nächsten Zugriff. Wer nie geteilt hat (Altbestand), bleibt unberührt.
 */
function pruneUnsharedSession(
    store: StoreFile,
    ownerUserId: string,
    trigger: "revoked" | "expired"
) {
    if (!store.sessions[ownerUserId]) {
        return false;
    }

    const grants = listGrantsByOwner(ownerUserId);

    if (grants.some((grant) => isGrantLive(grant))) {
        return false;
    }

    if (
        trigger === "expired" &&
        !grants.some((grant) => !grant.revokedAt)
    ) {
        return false;
    }

    delete store.sessions[ownerUserId];

    return true;
}

function pruneExpiredShares(store: StoreFile) {
    let pruned = false;

    for (const ownerUserId of Object.keys(store.sessions)) {
        if (pruneUnsharedSession(store, ownerUserId, "expired")) {
            pruned = true;
        }
    }

    return pruned;
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

    if (pruneExpiredShares(store)) {
        await writeStore(store);
    }

    const ownSession = store.sessions[userId] ?? null;

    const grantsGiven = listGrantsByOwner(userId).filter((grant) => !grant.revokedAt);
    const grantsReceived = listGrantsByGrantee(userId).filter((grant) => !grant.revokedAt);

    const hasActiveGrants = grantsGiven.some((grant) => isGrantLive(grant));

    // Geteilt wird nur, solange eine Freigabe lebt (auch nach Ablauf einer Freigabe).
    if (!hasActiveGrants) {
        deleteSnapshot(userId);
    }

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
        grantsReceived,
        // Die App lädt Snapshots nur hoch, wenn gerade geteilt wird.
        hasActiveGrants
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

    insertGrant(grant);

    return grant;
}

export async function revokeMyttGrant(params: {
    ownerUserId: string;
    grantId: string;
}) {
    const grant = getGrant(params.grantId);

    if (!grant || grant.ownerUserId !== params.ownerUserId) {
        return false;
    }

    markGrantRevoked(grant.id, nowIso());

    const store = await readStore();

    if (pruneUnsharedSession(store, params.ownerUserId, "revoked")) {
        await writeStore(store);
    }

    // Geteilt wird nur, solange eine Freigabe lebt: danach verschwindet auch der Snapshot vom Server.
    if (!listGrantsByOwner(params.ownerUserId).some((entry) => isGrantLive(entry))) {
        deleteSnapshot(params.ownerUserId);
    }

    return true;
}

export async function listMyttGrantsForOwner(ownerUserId: string) {
    return listGrantsByOwner(ownerUserId).filter((grant) => !grant.revokedAt);
}

export async function resolveMyttSessionForRequest(params: {
    requesterUserId: string;
    requiredScope: MyttScope;
}): Promise<ResolvedMyttSession> {
    const store = await readStore();

    if (pruneExpiredShares(store)) {
        await writeStore(store);
    }

    const ownSession = store.sessions[params.requesterUserId];

    if (ownSession?.status === "valid") {
        return {
            mode: "own",
            requesterUserId: params.requesterUserId,
            sessionOwnerUserId: params.requesterUserId,
            cookie: decryptText(ownSession.encryptedCookie)
        };
    }

    const activeGrant = listGrantsByGrantee(params.requesterUserId).find((grant) =>
        isGrantActive(grant, params.requiredScope)
    );

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