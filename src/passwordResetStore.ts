import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import crypto from "node:crypto";

type ResetTokenRecord = {
    id: string;
    userId: string;
    tokenHash: string;
    createdAt: string;
    expiresAt: string;
    usedAt: string | null;
};

type ResetStoreFile = {
    tokens: Record<string, ResetTokenRecord>;
};

export class InvalidResetTokenError extends Error {
    constructor() {
        super("Invalid or expired reset token");
        this.name = "InvalidResetTokenError";
    }
}

const RESET_STORE_FILE =
    process.env.TTTRACKER_PASSWORD_RESET_STORE_FILE ??
    "./data/password-resets.json";

const TOKEN_TTL_MS = 60 * 60 * 1000;

let writeQueue: Promise<void> = Promise.resolve();

function nowIso() {
    return new Date().toISOString();
}

function hashToken(rawToken: string) {
    return crypto.createHash("sha256").update(rawToken).digest("hex");
}

function isExpired(record: ResetTokenRecord, now: number) {
    return new Date(record.expiresAt).getTime() <= now;
}

async function readStore(): Promise<ResetStoreFile> {
    try {
        const raw = await readFile(RESET_STORE_FILE, "utf8");
        const parsed = JSON.parse(raw) as Partial<ResetStoreFile>;

        return {
            tokens: parsed.tokens ?? {}
        };
    } catch {
        return {
            tokens: {}
        };
    }
}

async function writeStore(store: ResetStoreFile) {
    await mkdir(dirname(RESET_STORE_FILE), { recursive: true, mode: 0o700 });

    writeQueue = writeQueue.then(() =>
        writeFile(RESET_STORE_FILE, JSON.stringify(store, null, 2), {
            mode: 0o600
        })
    );

    await writeQueue;
}

function pruneExpiredAndUsed(store: ResetStoreFile, now: number) {
    for (const [id, record] of Object.entries(store.tokens)) {
        if (record.usedAt !== null || isExpired(record, now)) {
            delete store.tokens[id];
        }
    }
}

/**
 * Creates a fresh reset token for a user and invalidates any previous ones.
 * Returns the raw token (only sent to the user); only its hash is stored.
 */
export async function createResetToken(userId: string): Promise<string> {
    const store = await readStore();
    const now = Date.now();

    pruneExpiredAndUsed(store, now);

    // Only one active reset per user at a time.
    for (const [id, record] of Object.entries(store.tokens)) {
        if (record.userId === userId) {
            delete store.tokens[id];
        }
    }

    const rawToken = crypto.randomBytes(32).toString("base64url");
    const record: ResetTokenRecord = {
        id: crypto.randomUUID(),
        userId,
        tokenHash: hashToken(rawToken),
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + TOKEN_TTL_MS).toISOString(),
        usedAt: null
    };

    store.tokens[record.id] = record;

    await writeStore(store);

    return rawToken;
}

/**
 * Validates a raw token and marks it used (one-time use). Returns the userId.
 * Throws InvalidResetTokenError if the token is unknown, expired or already used.
 */
export async function consumeResetToken(rawToken: string): Promise<string> {
    const store = await readStore();
    const now = Date.now();
    const tokenHash = hashToken(rawToken);

    const record = Object.values(store.tokens).find(
        (candidate) => candidate.tokenHash === tokenHash
    );

    if (!record || record.usedAt !== null || isExpired(record, now)) {
        throw new InvalidResetTokenError();
    }

    record.usedAt = new Date(now).toISOString();

    await writeStore(store);

    return record.userId;
}
