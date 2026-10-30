import { getMeetingTtlMs } from "../mytt/meetingTtl.js";
import { CACHE_TTL } from "../constants.js";
import type { MeetingLiveResponse } from "../schemas.js";
import { getStoreDb } from "./db.js";

/**
 * Nur abgeschlossene Berichte kommen in die Ablage: laufende und geplante ändern sich noch.
 * Die Regel hängt an derselben TTL Funktion wie der Cache, damit beide dasselbe als "fertig" ansehen.
 */
export function isStorableMeeting(response: MeetingLiveResponse) {
    return (
        response.data?.is_completed === true &&
        response.data.live !== true &&
        getMeetingTtlMs(response) === CACHE_TTL.MEETING_COMPLETED
    );
}

export function getStoredMeeting(meetingId: string): { value: MeetingLiveResponse; fetchedAt: number } | null {
    const db = getStoreDb();

    if (!db) {
        return null;
    }

    try {
        const row = db
            .prepare("SELECT data, fetched_at FROM meetings WHERE meeting_id = ?")
            .get(meetingId) as { data: string; fetched_at: number } | undefined;

        return row ? { value: JSON.parse(row.data) as MeetingLiveResponse, fetchedAt: row.fetched_at } : null;
    } catch (error) {
        console.warn("Could not read meeting from store", error);
        return null;
    }
}

export function storeMeeting(meetingId: string, response: MeetingLiveResponse, now = Date.now()) {
    const db = getStoreDb();

    if (!db || !isStorableMeeting(response)) {
        return false;
    }

    try {
        db.prepare(
            "INSERT OR REPLACE INTO meetings (meeting_id, data, fetched_at) VALUES (?, ?, ?)"
        ).run(meetingId, JSON.stringify(response), now);

        return true;
    } catch (error) {
        console.warn("Could not write meeting to store", error);
        return false;
    }
}

export function hasStoredMeeting(meetingId: string) {
    const db = getStoreDb();

    if (!db) {
        return false;
    }

    try {
        return db.prepare("SELECT 1 FROM meetings WHERE meeting_id = ?").get(meetingId) !== undefined;
    } catch {
        return false;
    }
}

export function countStoredMeetings() {
    const db = getStoreDb();

    if (!db) {
        return 0;
    }

    try {
        return (db.prepare("SELECT count(*) AS n FROM meetings").get() as { n: number }).n;
    } catch {
        return 0;
    }
}
