import { getStoreDb } from "./db.js";
import { StoreUnavailableError } from "./grantStore.js";

export type SnapshotRow = {
    userId: string;
    nuid: string;
    // Rohe myTischtennis Antworten, bereits gegen die Schemas geprüft.
    ttr: unknown | null;
    ttrFetchedAt: number | null;
    history: unknown | null;
    historyFetchedAt: number | null;
    lastUploadAt: number;
};

type Row = {
    user_id: string;
    nuid: string;
    ttr: string | null;
    ttr_fetched_at: number | null;
    history: string | null;
    history_fetched_at: number | null;
    last_upload_at: number;
};

function requireDb() {
    const db = getStoreDb();

    if (!db) {
        throw new StoreUnavailableError();
    }

    return db;
}

function toRow(row: Row): SnapshotRow {
    return {
        userId: row.user_id,
        nuid: row.nuid,
        ttr: row.ttr === null ? null : JSON.parse(row.ttr),
        ttrFetchedAt: row.ttr_fetched_at,
        history: row.history === null ? null : JSON.parse(row.history),
        historyFetchedAt: row.history_fetched_at,
        lastUploadAt: row.last_upload_at
    };
}

export function getSnapshotByUser(userId: string): SnapshotRow | null {
    const row = requireDb().prepare("SELECT * FROM mytt_snapshots WHERE user_id = ?").get(userId) as
        | Row
        | undefined;

    return row ? toRow(row) : null;
}

/** Snapshots, die zu dieser Spieler ID hochgeladen wurden (normalerweise einer), neueste zuerst. */
export function listSnapshotsByNuid(nuid: string): SnapshotRow[] {
    const rows = requireDb()
        .prepare("SELECT * FROM mytt_snapshots WHERE nuid = ? ORDER BY last_upload_at DESC")
        .all(nuid) as Row[];

    return rows.map(toRow);
}

/**
 * Speichert den Snapshot eines Users. Nur die mitgeschickten Teile ändern sich, ein anderer Teil bleibt,
 * solange die Spieler ID gleich ist. Bei einer neuen Spieler ID beginnt der Snapshot von vorn.
 */
export function saveSnapshot(params: {
    userId: string;
    nuid: string;
    ttr?: { value: unknown; fetchedAt: number };
    history?: { value: unknown; fetchedAt: number };
    now: number;
}) {
    const db = requireDb();
    const existing = getSnapshotByUser(params.userId);
    const keep = existing && existing.nuid === params.nuid ? existing : null;

    const ttr = params.ttr
        ? { json: JSON.stringify(params.ttr.value), at: params.ttr.fetchedAt }
        : keep?.ttr != null
            ? { json: JSON.stringify(keep.ttr), at: keep.ttrFetchedAt }
            : { json: null, at: null };

    const history = params.history
        ? { json: JSON.stringify(params.history.value), at: params.history.fetchedAt }
        : keep?.history != null
            ? { json: JSON.stringify(keep.history), at: keep.historyFetchedAt }
            : { json: null, at: null };

    db.prepare(
        `INSERT OR REPLACE INTO mytt_snapshots
            (user_id, nuid, ttr, ttr_fetched_at, history, history_fetched_at, last_upload_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(params.userId, params.nuid, ttr.json, ttr.at, history.json, history.at, params.now);
}

export function deleteSnapshot(userId: string) {
    requireDb().prepare("DELETE FROM mytt_snapshots WHERE user_id = ?").run(userId);
}
