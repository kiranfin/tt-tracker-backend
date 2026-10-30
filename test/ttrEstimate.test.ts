import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildTimeline, type RatedSingle } from "../src/rating/estimate.js";
import { expectedResult, kFactor, ratingChange } from "../src/rating/formula.js";
import { extractPlayerSingles } from "../src/rating/playerMatches.js";
import { isTemporarilyBlocked, planMeetingScan } from "../src/rating/playerEstimate.js";
import { LocalRateLimitError, UpstreamError, UpstreamRateLimitError } from "../src/upstream/errors.js";
import type { MeetingLiveData } from "../src/schemas.js";

describe("ttr formula", () => {
    it("expects 50 percent for equal ratings", () => {
        assert.equal(expectedResult(1500, 1500), 0.5);
    });

    it("gives about 91 percent at 150 points difference", () => {
        assert.ok(Math.abs(expectedResult(1650, 1500) - 10 / 11) < 1e-9);
    });

    it("changes by k/2 for equal ratings", () => {
        assert.equal(ratingChange({ own: 1500, opponent: 1500, won: true }), 8);
        assert.equal(ratingChange({ own: 1500, opponent: 1500, won: false }), -8);
    });

    it("rewards upsets and punishes expected wins little", () => {
        assert.equal(ratingChange({ own: 1500, opponent: 1650, won: true }), 15);
        assert.equal(ratingChange({ own: 1500, opponent: 1650, won: false }), -1);
        assert.equal(ratingChange({ own: 1650, opponent: 1500, won: true }), 1);
        assert.equal(ratingChange({ own: 1650, opponent: 1500, won: false }), -15);
    });

    it("scales with k and adds bonuses only when they apply", () => {
        assert.equal(ratingChange({ own: 1500, opponent: 1500, won: true, k: 32 }), 16);
        assert.equal(kFactor(), 16);
        assert.equal(kFactor({ youth: true, youthBonus: 4 }), 20);
        assert.equal(kFactor({ youth: false, youthBonus: 4, fewGames: true, fewGamesBonus: 8 }), 24);
    });
});

function single(date: string, opponentTtr: number, won: boolean): RatedSingle {
    return {
        meetingId: date,
        date,
        teamHome: "A",
        teamGuest: "B",
        won,
        setsOwn: won ? 3 : 1,
        setsOther: won ? 1 : 3,
        opponent: { personId: "NU1", name: "Gegner", organization: "TTBW", clubNumber: "1" },
        opponentTtr
    };
}

describe("buildTimeline", () => {
    const now = Date.parse("2026-10-30T12:00:00Z");

    it("returns the public value and no events without matches", () => {
        const timeline = buildTimeline({ publicValue: 1500, publicAsOf: now, singles: [] });

        assert.equal(timeline.current, 1500);
        assert.equal(timeline.adjustedForward, false);
        assert.deepEqual(timeline.events, []);
    });

    it("reconstructs earlier values backwards from the public value", () => {
        const timeline = buildTimeline({
            publicValue: 1500,
            publicAsOf: now,
            singles: [
                single("2026-10-01T10:00:00Z", 1500, true),
                single("2026-10-10T10:00:00Z", 1500, false)
            ]
        });

        assert.equal(timeline.current, 1500);
        assert.equal(timeline.events.length, 2);

        const [first, second] = timeline.events;

        // Die Ereignisse hängen aneinander und enden beim öffentlichen Wert.
        assert.equal(second!.ttrAfter, 1500);
        assert.equal(first!.ttrAfter, second!.ttrBefore);
        assert.equal(second!.ttrAfter - second!.ttrBefore, second!.delta);
        assert.ok(second!.delta < 0);
        assert.ok(first!.delta > 0);
    });

    it("applies matches after the public stand forwards", () => {
        const timeline = buildTimeline({
            publicValue: 1500,
            publicAsOf: Date.parse("2026-10-05T00:00:00Z"),
            singles: [
                single("2026-10-01T10:00:00Z", 1500, true),
                single("2026-10-10T10:00:00Z", 1500, true)
            ]
        });

        assert.equal(timeline.adjustedForward, true);
        assert.equal(timeline.events[1]!.ttrBefore, 1500);
        assert.equal(timeline.events[1]!.ttrAfter, 1508);
        assert.equal(timeline.current, 1508);
    });

    it("ignores matches without a usable date", () => {
        const timeline = buildTimeline({
            publicValue: 1500,
            publicAsOf: now,
            singles: [single("kaputt", 1500, true)]
        });

        assert.deepEqual(timeline.events, []);
    });
});

function player(personId: string, firstname = "X", lastname = "Y") {
    return { person_id: personId, firstname, lastname, player_fed_nickname: "TTBW" };
}

const MEETING = {
    scheduled: "2026-10-24T16:30:00.000+00:00",
    team_home: "Home",
    team_guest: "Guest",
    fed_nickname: "TTBW",
    team_home_club_nr: "100",
    team_guest_club_nr: "200",
    match: [
        { game_type: "single", sets_home: 3, sets_guest: 1, mm_player11: player("NU1"), mm_player21: player("NU2") },
        { game_type: "single", sets_home: 3, sets_guest: 1, mm_player11: player("NU3"), mm_player21: player("NU1") },
        { game_type: "double", sets_home: 3, sets_guest: 0, mm_player11: player("NU1"), mm_player21: player("NU2") },
        { game_type: "single", sets_home: 3, sets_guest: 0, home_wo: true, mm_player11: player("NU1"), mm_player21: player("NU2") },
        { game_type: "single", sets_home: 3, sets_guest: 2, mm_player11: player("NU4"), mm_player21: player("NU5") }
    ]
} as unknown as MeetingLiveData;

describe("extractPlayerSingles", () => {
    it("returns rated singles of the player from both sides", () => {
        const singles = extractPlayerSingles(MEETING, "1", "nu1");

        assert.equal(singles.length, 2);

        assert.equal(singles[0]!.won, true);
        assert.equal(singles[0]!.opponent.personId, "NU2");
        assert.equal(singles[0]!.opponent.clubNumber, "200");

        assert.equal(singles[1]!.won, false);
        assert.equal(singles[1]!.setsOwn, 1);
        assert.equal(singles[1]!.setsOther, 3);
        assert.equal(singles[1]!.opponent.personId, "NU3");
        assert.equal(singles[1]!.opponent.clubNumber, "100");
    });

    it("skips doubles, walkovers and other players", () => {
        assert.equal(extractPlayerSingles(MEETING, "1", "NU4").length, 1);
        assert.equal(extractPlayerSingles(MEETING, "1", "NU999").length, 0);
    });
});

describe("isTemporarilyBlocked", () => {
    it("aborts the estimate while myTischtennis is throttled", () => {
        assert.equal(isTemporarilyBlocked(new LocalRateLimitError(60_000, "breaker_open")), true);
        assert.equal(isTemporarilyBlocked(new LocalRateLimitError(5_000, "queue_full")), true);
        assert.equal(isTemporarilyBlocked(new UpstreamRateLimitError()), true);
    });

    it("skips single broken reports instead of aborting", () => {
        assert.equal(isTemporarilyBlocked(new UpstreamError("not found", 404)), false);
        assert.equal(isTemporarilyBlocked(new Error("boom")), false);
    });
});

describe("planMeetingScan", () => {
    // Neueste zuerst, wie getPastMeetingIds sie liefert.
    const meetings = ["m6", "m5", "m4", "m3", "m2", "m1"].map((id) => ({ id }));

    it("takes all stored reports and loads the newest missing ones up to the budget", () => {
        const stored = new Set(["m5", "m2", "m1"]);
        const plan = planMeetingScan(meetings, (id) => stored.has(id), 2);

        assert.deepEqual(plan.fromStore.map((meeting) => meeting.id), ["m5", "m2", "m1"]);
        assert.deepEqual(plan.toLoad.map((meeting) => meeting.id), ["m6", "m4"]);
        assert.equal(plan.pending, 1);
    });

    it("has nothing pending once the budget covers all missing reports", () => {
        const plan = planMeetingScan(meetings, () => false, 10);

        assert.equal(plan.toLoad.length, 6);
        assert.equal(plan.pending, 0);
    });

    it("loads nothing with a budget of zero and reports everything as pending", () => {
        const plan = planMeetingScan(meetings, () => false, 0);

        assert.equal(plan.toLoad.length, 0);
        assert.equal(plan.pending, 6);
    });
});
