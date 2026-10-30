import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config.js";

const SCHEMA_VERSION = 2;

// Berichte, die länger als zwei Saisons zurückliegen, braucht keine Schätzung mehr.
const MEETING_MAX_AGE_MS = 2 * 365 * 24 * 60 * 60 * 1000;

let db: DatabaseSync | null = null;
let opened = false;

function migrate(database: DatabaseSync) {
    database.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");

    const row = database.prepare("SELECT version FROM schema_version").get() as
        | { version: number }
        | undefined;

    if (row && row.version >= SCHEMA_VERSION) {
        return;
    }

    database.exec(`
        CREATE TABLE IF NOT EXISTS meetings (
            meeting_id TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            fetched_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS opponent_ratings (
            meeting_id TEXT NOT NULL,
            person_id TEXT NOT NULL,
            ttr INTEGER NOT NULL,
            rated_at INTEGER NOT NULL,
            PRIMARY KEY (meeting_id, person_id)
        );
        CREATE TABLE IF NOT EXISTS mytt_grants (
            id TEXT PRIMARY KEY,
            owner_user_id TEXT NOT NULL,
            grantee_user_id TEXT NOT NULL,
            scopes TEXT NOT NULL,
            expires_at TEXT,
            created_at TEXT NOT NULL,
            revoked_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_mytt_grants_owner ON mytt_grants (owner_user_id);
        CREATE INDEX IF NOT EXISTS idx_mytt_grants_grantee ON mytt_grants (grantee_user_id);
        CREATE TABLE IF NOT EXISTS mytt_snapshots (
            user_id TEXT PRIMARY KEY,
            nuid TEXT NOT NULL,
            ttr TEXT,
            ttr_fetched_at INTEGER,
            history TEXT,
            history_fetched_at INTEGER,
            last_upload_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mytt_snapshots_nuid ON mytt_snapshots (nuid);
    `);

    database.exec("DELETE FROM schema_version");
    database.prepare("INSERT INTO schema_version (version) VALUES (?)").run(SCHEMA_VERSION);
}

function purgeOldMeetings(database: DatabaseSync, now: number) {
    const cutoff = now - MEETING_MAX_AGE_MS;

    database.prepare("DELETE FROM meetings WHERE fetched_at < ?").run(cutoff);
    database.prepare("DELETE FROM opponent_ratings WHERE rated_at < ?").run(cutoff);
}

/**
 * Öffnet die Ablage beim ersten Aufruf. Ist sie abgeschaltet oder lässt sich nicht öffnen, liefert
 * die Funktion null, und alle Aufrufer arbeiten ohne Ablage weiter.
 */
export function getStoreDb(): DatabaseSync | null {
    if (opened) {
        return db;
    }

    opened = true;

    if (!config.store.enabled) {
        console.info("Persistent store disabled (STORE_ENABLED=false)");
        return null;
    }

    try {
        if (config.store.file !== ":memory:") {
            mkdirSync(dirname(config.store.file), { recursive: true });
        }

        const database = new DatabaseSync(config.store.file);

        database.exec("PRAGMA journal_mode = WAL");
        migrate(database);
        purgeOldMeetings(database, Date.now());

        db = database;
    } catch (error) {
        console.warn("Could not open persistent store, continuing without it", error);
        db = null;
    }

    return db;
}

/** Schließt die Ablage, z.B. beim Beenden. */
export function closeStore() {
    try {
        db?.close();
    } catch {
        // Beim Beenden gibt es nichts mehr zu retten.
    }

    db = null;
}

export function getStoreStatus() {
    const database = getStoreDb();

    if (!database) {
        return { enabled: false, file: config.store.file, meetings: 0, opponentRatings: 0 };
    }

    const count = (table: "meetings" | "opponent_ratings") =>
        (database.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

    return {
        enabled: true,
        file: config.store.file,
        meetings: count("meetings"),
        opponentRatings: count("opponent_ratings")
    };
}
