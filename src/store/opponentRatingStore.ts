import { getStoreDb } from "./db.js";

export type OpponentRatingKey = { meetingId: string; personId: string };
export type OpponentRatingRow = OpponentRatingKey & { ttr: number; ratedAt?: number };

const keyOf = (key: OpponentRatingKey) => `${key.meetingId}:${key.personId}`;

/** Gespeicherte Gegnerwerte, Schlüssel "meetingId:personId". Fehlende Einträge fehlen in der Map. */
export function getOpponentRatings(keys: OpponentRatingKey[]) {
    const result = new Map<string, number>();
    const db = getStoreDb();

    if (!db || keys.length === 0) {
        return result;
    }

    try {
        const statement = db.prepare(
            "SELECT ttr FROM opponent_ratings WHERE meeting_id = ? AND person_id = ?"
        );

        for (const key of keys) {
            const row = statement.get(key.meetingId, key.personId) as { ttr: number } | undefined;

            if (row) {
                result.set(keyOf(key), row.ttr);
            }
        }
    } catch (error) {
        console.warn("Could not read opponent ratings from store", error);
    }

    return result;
}

/** Speichert Gegnerwerte. Ein vorhandener Wert wird nie überschrieben: der erste Stand gilt. */
export function saveOpponentRatings(rows: OpponentRatingRow[], now = Date.now()) {
    const db = getStoreDb();

    if (!db || rows.length === 0) {
        return;
    }

    try {
        const statement = db.prepare(
            "INSERT OR IGNORE INTO opponent_ratings (meeting_id, person_id, ttr, rated_at) VALUES (?, ?, ?, ?)"
        );

        db.exec("BEGIN");

        try {
            for (const row of rows) {
                statement.run(row.meetingId, row.personId, Math.round(row.ttr), row.ratedAt ?? now);
            }

            db.exec("COMMIT");
        } catch (error) {
            db.exec("ROLLBACK");
            throw error;
        }
    } catch (error) {
        console.warn("Could not write opponent ratings to store", error);
    }
}

export { keyOf as opponentRatingKey };
