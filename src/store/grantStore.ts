import type { DatabaseSync } from "node:sqlite";
import { getStoreDb } from "./db.js";

export type MyttScope = "ttr:read" | "ttr_history:read";

export type MyttGrant = {
    id: string;
    ownerUserId: string;
    granteeUserId: string;
    scopes: MyttScope[];
    expiresAt?: string | null;
    createdAt: string;
    revokedAt?: string | null;
};

export class StoreUnavailableError extends Error {
    constructor() {
        super("Persistent store is not available");
        this.name = "StoreUnavailableError";
    }
}

type GrantRow = {
    id: string;
    owner_user_id: string;
    grantee_user_id: string;
    scopes: string;
    expires_at: string | null;
    created_at: string;
    revoked_at: string | null;
};

/** Freigaben liegen in der Ablage (SQLite). Ohne Ablage gibt es keine Freigaben. */
function requireDb(): DatabaseSync {
    const db = getStoreDb();

    if (!db) {
        throw new StoreUnavailableError();
    }

    return db;
}

function toGrant(row: GrantRow): MyttGrant {
    return {
        id: row.id,
        ownerUserId: row.owner_user_id,
        granteeUserId: row.grantee_user_id,
        scopes: JSON.parse(row.scopes) as MyttScope[],
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        revokedAt: row.revoked_at
    };
}

export function insertGrant(grant: MyttGrant) {
    requireDb()
        .prepare(
            `INSERT INTO mytt_grants
                (id, owner_user_id, grantee_user_id, scopes, expires_at, created_at, revoked_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
            grant.id,
            grant.ownerUserId,
            grant.granteeUserId,
            JSON.stringify(grant.scopes),
            grant.expiresAt ?? null,
            grant.createdAt,
            grant.revokedAt ?? null
        );
}

export function getGrant(id: string): MyttGrant | null {
    const row = requireDb().prepare("SELECT * FROM mytt_grants WHERE id = ?").get(id) as
        | GrantRow
        | undefined;

    return row ? toGrant(row) : null;
}

/** Alle Freigaben eines Besitzers, auch widerrufene. */
export function listGrantsByOwner(ownerUserId: string): MyttGrant[] {
    const rows = requireDb()
        .prepare("SELECT * FROM mytt_grants WHERE owner_user_id = ? ORDER BY created_at")
        .all(ownerUserId) as GrantRow[];

    return rows.map(toGrant);
}

/** Alle Freigaben, die ein User erhalten hat, auch widerrufene. */
export function listGrantsByGrantee(granteeUserId: string): MyttGrant[] {
    const rows = requireDb()
        .prepare("SELECT * FROM mytt_grants WHERE grantee_user_id = ? ORDER BY created_at")
        .all(granteeUserId) as GrantRow[];

    return rows.map(toGrant);
}

export function markGrantRevoked(id: string, revokedAt: string) {
    requireDb().prepare("UPDATE mytt_grants SET revoked_at = ? WHERE id = ?").run(revokedAt, id);
}

/** Übernimmt Freigaben aus der alten JSON Datei. Vorhandene bleiben unverändert (auch widerrufene). */
export function importLegacyGrants(grants: MyttGrant[]) {
    const db = requireDb();
    const statement = db.prepare(
        `INSERT OR IGNORE INTO mytt_grants
            (id, owner_user_id, grantee_user_id, scopes, expires_at, created_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    db.exec("BEGIN");

    try {
        for (const grant of grants) {
            statement.run(
                grant.id,
                grant.ownerUserId,
                grant.granteeUserId,
                JSON.stringify(grant.scopes),
                grant.expiresAt ?? null,
                grant.createdAt,
                grant.revokedAt ?? null
            );
        }

        db.exec("COMMIT");
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}

/** Freigabe, die weder widerrufen noch abgelaufen ist, unabhängig vom Scope. */
export function isGrantLive(grant: MyttGrant, now = Date.now()) {
    if (grant.revokedAt) {
        return false;
    }

    return !grant.expiresAt || new Date(grant.expiresAt).getTime() > now;
}

export function isGrantActive(grant: MyttGrant, requiredScope: MyttScope, now = Date.now()) {
    return isGrantLive(grant, now) && grant.scopes.includes(requiredScope);
}
