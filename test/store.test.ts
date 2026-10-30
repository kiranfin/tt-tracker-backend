import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { getMeeting } from "../src/services/meeting.js";
import type { MeetingLiveResponse } from "../src/schemas.js";
import { getStoreDb } from "../src/store/db.js";
import { countStoredMeetings, getStoredMeeting, storeMeeting } from "../src/store/meetingStore.js";
import { getOpponentRatings, opponentRatingKey, saveOpponentRatings } from "../src/store/opponentRatingStore.js";

function report(overrides: Record<string, unknown>) {
    return {
        data: {
            scheduled: "2026-10-24T16:30:00.000+00:00",
            team_home: "Home",
            team_guest: "Guest",
            match: [],
            ...overrides
        }
    } as unknown as MeetingLiveResponse;
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
    const db = getStoreDb();

    assert.ok(db, "store opens in memory during tests");
    db.exec("DELETE FROM meetings; DELETE FROM opponent_ratings;");
});

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe("meeting store", () => {
    it("stores completed reports", () => {
        assert.equal(storeMeeting("100", report({ is_completed: true })), true);

        const stored = getStoredMeeting("100");

        assert.equal(stored?.value.data?.team_home, "Home");
        assert.equal(countStoredMeetings(), 1);
    });

    it("ignores live and planned reports", () => {
        assert.equal(storeMeeting("101", report({ is_completed: false, live: true })), false);
        assert.equal(storeMeeting("102", report({ is_completed: false })), false);
        assert.equal(storeMeeting("103", report({ is_completed: true, live: true })), false);

        assert.equal(countStoredMeetings(), 0);
        assert.equal(getStoredMeeting("102"), null);
    });

    it("serves a stored report without asking myTischtennis", async () => {
        storeMeeting("200", report({ is_completed: true }), Date.parse("2026-10-25T10:00:00Z"));

        globalThis.fetch = (() => {
            throw new Error("fetch must not be called");
        }) as typeof fetch;

        const result = await getMeeting("200");

        assert.equal(result.meta.source, "cache");
        assert.equal(result.value.data?.team_guest, "Guest");
        assert.equal(result.meta.fetchedAt, "2026-10-25T10:00:00.000Z");
    });
});

describe("opponent rating store", () => {
    it("saves values and reads them back by meeting and person", () => {
        saveOpponentRatings([
            { meetingId: "1", personId: "10", ttr: 1500 },
            { meetingId: "1", personId: "11", ttr: 1620 }
        ]);

        const ratings = getOpponentRatings([
            { meetingId: "1", personId: "10" },
            { meetingId: "1", personId: "11" },
            { meetingId: "2", personId: "10" }
        ]);

        assert.equal(ratings.get(opponentRatingKey({ meetingId: "1", personId: "10" })), 1500);
        assert.equal(ratings.get(opponentRatingKey({ meetingId: "1", personId: "11" })), 1620);
        assert.equal(ratings.has(opponentRatingKey({ meetingId: "2", personId: "10" })), false);
    });

    it("never overwrites an existing value", () => {
        saveOpponentRatings([{ meetingId: "1", personId: "10", ttr: 1500 }]);
        saveOpponentRatings([{ meetingId: "1", personId: "10", ttr: 1700 }]);

        const ratings = getOpponentRatings([{ meetingId: "1", personId: "10" }]);

        assert.equal(ratings.get(opponentRatingKey({ meetingId: "1", personId: "10" })), 1500);
    });
});
