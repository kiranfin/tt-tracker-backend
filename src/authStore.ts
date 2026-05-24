import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import crypto from "node:crypto";

type StoredUser = {
    id: string;
    username: string;
    passwordHash: string;
    salt: string;
    createdAt: string;
    updatedAt: string;
};

type UserStoreFile = {
    users: Record<string, StoredUser>;
};

export type PublicAppUser = {
    id: string;
    username: string;
};

export class UsernameAlreadyExistsError extends Error {
    constructor() {
        super("Username already exists");
        this.name = "UsernameAlreadyExistsError";
    }
}

export class InvalidCredentialsError extends Error {
    constructor() {
        super("Invalid credentials");
        this.name = "InvalidCredentialsError";
    }
}

const USER_STORE_FILE =
    process.env.TTTRACKER_USER_STORE_FILE ?? "./data/users.json";

let writeQueue: Promise<void> = Promise.resolve();

function nowIso() {
    return new Date().toISOString();
}

function normalizeUsername(username: string) {
    return username.trim().toLowerCase();
}

function isValidUsername(username: string) {
    return /^[a-z0-9._-]{2,32}$/.test(username);
}

function assertValidUsername(username: string) {
    const normalized = normalizeUsername(username);

    if (!isValidUsername(normalized)) {
        throw new Error(
            "Ungültiger Benutzername. Erlaubt: a-z, 0-9, Punkt, Unterstrich, Minus. Länge: 2-32."
        );
    }

    return normalized;
}

function assertValidPassword(password: string) {
    if (password.length < 8) {
        throw new Error("Passwort muss mindestens 8 Zeichen haben.");
    }
}

async function readStore(): Promise<UserStoreFile> {
    try {
        const raw = await readFile(USER_STORE_FILE, "utf8");
        const parsed = JSON.parse(raw) as Partial<UserStoreFile>;

        return {
            users: parsed.users ?? {}
        };
    } catch {
        return {
            users: {}
        };
    }
}

async function writeStore(store: UserStoreFile) {
    await mkdir(dirname(USER_STORE_FILE), { recursive: true, mode: 0o700 });

    writeQueue = writeQueue.then(() =>
        writeFile(USER_STORE_FILE, JSON.stringify(store, null, 2), {
            mode: 0o600
        })
    );

    await writeQueue;
}

function hashPassword(password: string, salt: string) {
    return crypto.scryptSync(password, salt, 64).toString("hex");
}

function safeEqualHex(a: string, b: string) {
    const aBuffer = Buffer.from(a, "hex");
    const bBuffer = Buffer.from(b, "hex");

    if (aBuffer.length !== bBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function toPublicUser(user: StoredUser): PublicAppUser {
    return {
        id: user.id,
        username: user.username
    };
}

export async function createAppUser(params: {
    username: string;
    password: string;
}): Promise<PublicAppUser> {
    const username = assertValidUsername(params.username);
    assertValidPassword(params.password);

    const store = await readStore();

    const existing = Object.values(store.users).find(
        (user) => user.username === username
    );

    if (existing) {
        throw new UsernameAlreadyExistsError();
    }

    const id = crypto.randomUUID();
    const salt = crypto.randomBytes(16).toString("hex");
    const now = nowIso();

    const user: StoredUser = {
        id,
        username,
        salt,
        passwordHash: hashPassword(params.password, salt),
        createdAt: now,
        updatedAt: now
    };

    store.users[id] = user;

    await writeStore(store);

    return toPublicUser(user);
}

export async function verifyAppUserLogin(params: {
    username: string;
    password: string;
}): Promise<PublicAppUser> {
    const username = normalizeUsername(params.username);
    const store = await readStore();

    const user = Object.values(store.users).find(
        (candidate) => candidate.username === username
    );

    if (!user) {
        throw new InvalidCredentialsError();
    }

    const candidateHash = hashPassword(params.password, user.salt);

    if (!safeEqualHex(candidateHash, user.passwordHash)) {
        throw new InvalidCredentialsError();
    }

    return toPublicUser(user);
}

export async function findAppUserById(
    userId: string
): Promise<PublicAppUser | null> {
    const store = await readStore();
    const user = store.users[userId];

    return user ? toPublicUser(user) : null;
}