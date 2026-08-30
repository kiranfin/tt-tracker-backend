import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import crypto from "node:crypto";

type StoredUser = {
    id: string;
    username: string;
    email?: string;
    emailNormalized?: string;
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
    email?: string;
};

export class UsernameAlreadyExistsError extends Error {
    constructor() {
        super("Username already exists");
        this.name = "UsernameAlreadyExistsError";
    }
}

export class EmailAlreadyExistsError extends Error {
    constructor() {
        super("Email already exists");
        this.name = "EmailAlreadyExistsError";
    }
}

export class UserNotFoundError extends Error {
    constructor() {
        super("User not found");
        this.name = "UserNotFoundError";
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

function normalizeEmail(email: string) {
    return email.trim().toLowerCase();
}

function isValidEmail(email: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function assertValidEmail(email: string) {
    const normalized = normalizeEmail(email);

    if (!isValidEmail(normalized)) {
        throw new Error("Ungültige E-Mail-Adresse.");
    }

    return normalized;
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
        username: user.username,
        ...(user.email ? { email: user.email } : {})
    };
}

export async function createAppUser(params: {
    username: string;
    password: string;
    email?: string;
}): Promise<PublicAppUser> {
    const username = assertValidUsername(params.username);
    assertValidPassword(params.password);

    const email =
        params.email !== undefined ? assertValidEmail(params.email) : undefined;

    const store = await readStore();

    const existing = Object.values(store.users).find(
        (user) => user.username === username
    );

    if (existing) {
        throw new UsernameAlreadyExistsError();
    }

    if (
        email &&
        Object.values(store.users).some(
            (user) => user.emailNormalized === email
        )
    ) {
        throw new EmailAlreadyExistsError();
    }

    const id = crypto.randomUUID();
    const salt = crypto.randomBytes(16).toString("hex");
    const now = nowIso();

    const user: StoredUser = {
        id,
        username,
        ...(email ? { email, emailNormalized: email } : {}),
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

export async function findAppUserByUsername(
    usernameInput: string
): Promise<PublicAppUser | null> {
    const username = normalizeUsername(usernameInput);
    const store = await readStore();

    const user = Object.values(store.users).find(
        (candidate) => candidate.username === username
    );

    return user ? toPublicUser(user) : null;
}

export async function findAppUserByEmail(
    emailInput: string
): Promise<PublicAppUser | null> {
    const email = normalizeEmail(emailInput);
    const store = await readStore();

    const user = Object.values(store.users).find(
        (candidate) => candidate.emailNormalized === email
    );

    return user ? toPublicUser(user) : null;
}

export async function setAppUserEmail(
    userId: string,
    emailInput: string
): Promise<PublicAppUser> {
    const email = assertValidEmail(emailInput);
    const store = await readStore();

    const user = store.users[userId];

    if (!user) {
        throw new UserNotFoundError();
    }

    const takenByOther = Object.values(store.users).some(
        (candidate) =>
            candidate.id !== userId && candidate.emailNormalized === email
    );

    if (takenByOther) {
        throw new EmailAlreadyExistsError();
    }

    user.email = email;
    user.emailNormalized = email;
    user.updatedAt = nowIso();

    await writeStore(store);

    return toPublicUser(user);
}

export async function setAppUserPassword(
    userId: string,
    newPassword: string
): Promise<PublicAppUser> {
    assertValidPassword(newPassword);

    const store = await readStore();

    const user = store.users[userId];

    if (!user) {
        throw new UserNotFoundError();
    }

    user.salt = crypto.randomBytes(16).toString("hex");
    user.passwordHash = hashPassword(newPassword, user.salt);
    user.updatedAt = nowIso();

    await writeStore(store);

    return toPublicUser(user);
}