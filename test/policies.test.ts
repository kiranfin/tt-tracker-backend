import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cacheKeys } from "../src/cacheKeys.js";
import {
    DATA_POLICIES,
    EMPTY_RESULT_FRESH_MS,
    getFreshMs,
    MEETING_COMPLETED_FRESH_MS,
    type DataKind
} from "../src/policies.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("data policies", () => {
    it("gives every kind a usable policy", () => {
        for (const [kind, policy] of Object.entries(DATA_POLICIES)) {
            assert.ok(policy.staleMax > 0, `${kind} staleMax`);
            assert.ok(["interactive", "background"].includes(policy.priority), `${kind} priority`);
            assert.ok(typeof policy.fresh === "function" || policy.fresh > 0, `${kind} fresh`);
        }
    });

    it("holds the agreed freshness per kind", () => {
        const fixed: Array<[DataKind, number]> = [
            ["PLAYER_SEARCH", DAY],
            ["CLUB_SEARCH", DAY],
            ["PLAYER_TTR", 30 * MINUTE],
            ["PLAYER_TTR_HISTORY", HOUR],
            ["CLUB_TEAMS", HOUR],
            ["CLUB_INFO", 12 * HOUR],
            ["CLUB_HEAD", 30 * DAY],
            ["ANDRO_CLUB_NR", 30 * DAY],
            ["TEAM_PLAYERS", 10 * MINUTE],
            ["TEAM_SIMPLE_SCHEDULE", 5 * MINUTE],
            ["TEAM_INFOS", 15 * MINUTE],
            ["EVENTS_LIST", 30 * MINUTE],
            ["EVENTS_DETAIL", HOUR]
        ];

        for (const [kind, expected] of fixed) {
            assert.equal(getFreshMs(kind, {}), expected, kind);
        }
    });

    it("shortens empty results only", () => {
        assert.equal(getFreshMs("LEAGUE_TABLE", { data: [] }), EMPTY_RESULT_FRESH_MS);
        assert.equal(getFreshMs("LEAGUE_TABLE", { data: [{}] }), 15 * MINUTE);
        assert.equal(getFreshMs("CLUB_PLAYERS", { data: [] }), EMPTY_RESULT_FRESH_MS);
        assert.equal(getFreshMs("CLUB_PLAYERS", { data: [{}] }), HOUR);
        assert.equal(getFreshMs("LEAGUE_REGIONS", { regions: [] }), EMPTY_RESULT_FRESH_MS);
        assert.equal(getFreshMs("LEAGUE_REGIONS", { regions: [1] }), 7 * DAY);
        assert.equal(getFreshMs("LEAGUE_CLASSES", { classes: [] }), EMPTY_RESULT_FRESH_MS);
        assert.equal(getFreshMs("LEAGUE_CLASSES", { classes: [1] }), 7 * DAY);
        assert.equal(getFreshMs("PLAYER_CLUB", null), EMPTY_RESULT_FRESH_MS);
        assert.equal(getFreshMs("PLAYER_CLUB", { clubNumber: "1" }), 12 * HOUR);
    });

    it("rechecks an incomplete estimate quickly", () => {
        assert.equal(
            getFreshMs("PLAYER_TTR_ESTIMATE", { coverage: { pending: 2 } }),
            EMPTY_RESULT_FRESH_MS
        );
        assert.equal(getFreshMs("PLAYER_TTR_ESTIMATE", { coverage: { pending: 0 } }), 30 * MINUTE);
    });

    it("tells live, planned and completed meetings apart", () => {
        const now = Date.parse("2026-10-30T12:00:00Z");

        assert.equal(getFreshMs("MEETING", { data: { live: true } }, { now }), MINUTE);
        assert.equal(getFreshMs("MEETING", { data: { live: false } }, { now }), 2 * MINUTE);
        assert.equal(
            getFreshMs("MEETING", { data: { is_completed: true } }, { now }),
            MEETING_COMPLETED_FRESH_MS
        );
    });

    it("keeps a planned meeting fresh until it starts, at most a day", () => {
        const now = Date.parse("2026-10-30T12:00:00Z");

        assert.equal(
            getFreshMs("MEETING", { data: { scheduled: "2026-10-30T16:00:00Z" } }, { now }),
            4 * HOUR
        );
        assert.equal(
            getFreshMs("MEETING", { data: { scheduled: "2026-11-20T16:00:00Z" } }, { now }),
            DAY
        );
        assert.equal(
            getFreshMs("MEETING", { data: { scheduled: "2026-10-30T12:00:30Z" } }, { now }),
            2 * MINUTE
        );
    });
});

describe("freshness by schedule", () => {
    const now = Date.parse("2026-10-30T12:00:00Z");

    function leagueSchedule(...dates: string[]) {
        return {
            data: {
                meetings: [
                    { day: dates.map((date) => ({ date, team_home: "A", team_away: "B" })) }
                ]
            }
        };
    }

    it("keeps a league schedule fresh until the next match is over (start plus 3 hours)", () => {
        // Beginn in 3 Stunden, Ende in 6 Stunden.
        assert.equal(
            getFreshMs("LEAGUE_SCHEDULE", leagueSchedule("2026-10-30T15:00:00Z"), { now }),
            6 * HOUR
        );
        // Ende in mehr als 24 Stunden: gedeckelt.
        assert.equal(
            getFreshMs("LEAGUE_SCHEDULE", leagueSchedule("2026-11-05T10:00:00Z"), { now }),
            DAY
        );
    });

    it("uses the earliest upcoming match and ignores finished ones", () => {
        const value = leagueSchedule(
            "2026-10-01T10:00:00Z",
            "2026-10-30T20:00:00Z",
            "2026-11-05T10:00:00Z"
        );

        // Ende des Termins um 23:00, in 11 Stunden.
        assert.equal(getFreshMs("LEAGUE_SCHEDULE", value, { now }), 11 * HOUR);
    });

    it("checks every 10 minutes while a match is running", () => {
        const value = leagueSchedule("2026-10-30T11:00:00Z", "2026-11-05T10:00:00Z");

        assert.equal(getFreshMs("LEAGUE_SCHEDULE", value, { now }), 10 * MINUTE);
    });

    it("keeps the live check until the match is over", () => {
        const value = leagueSchedule("2026-10-30T15:00:00Z");

        // Kurz vor Ende des Termins.
        assert.equal(
            getFreshMs("LEAGUE_SCHEDULE", value, { now: Date.parse("2026-10-30T17:59:00Z") }),
            10 * MINUTE,
            "a running match counts as live window"
        );
        assert.equal(
            getFreshMs("LEAGUE_SCHEDULE", leagueSchedule("2026-10-30T12:03:00Z", "2026-10-30T12:01:00Z"), {
                now: Date.parse("2026-10-30T12:00:00Z")
            }),
            // Beginn in einer Minute: Ende in 3 Stunden 1 Minute.
            3 * HOUR + MINUTE
        );
    });

    it("holds the maximum when no match is left", () => {
        assert.equal(
            getFreshMs("LEAGUE_SCHEDULE", leagueSchedule("2026-05-01T10:00:00Z"), { now }),
            DAY
        );
    });

    it("limits the club schedule to 12 hours", () => {
        const value = {
            data: { meetings: [{ date: "2026-11-20T10:00:00Z", team_home: "A", team_away: "B" }] }
        };

        assert.equal(getFreshMs("CLUB_SCHEDULE", value, { now }), 12 * HOUR);
    });

    it("treats a date without time as lasting until the end of that day", () => {
        // Das Ende liegt am 31.10. um 00:00 UTC, in 12 Stunden. Beginn war scheinbar 21:00, also nicht laufend.
        assert.equal(
            getFreshMs("LEAGUE_SCHEDULE", leagueSchedule("2026-10-30"), { now }),
            12 * HOUR
        );
    });

    it("lets table and balances follow the schedule window, and fall back without one", () => {
        const table = { data: [{ rank: 1 }] };

        assert.equal(getFreshMs("LEAGUE_TABLE", table, { now }), 15 * MINUTE);
        assert.equal(getFreshMs("LEAGUE_TABLE", table, { now, matchWindow: null }), 15 * MINUTE);
        assert.equal(
            getFreshMs("LEAGUE_TABLE", table, {
                now,
                matchWindow: { activeNow: false, nextEnd: now + 8 * HOUR }
            }),
            8 * HOUR
        );
        assert.equal(
            getFreshMs("LEAGUE_TABLE", table, {
                now,
                matchWindow: { activeNow: true, nextEnd: now + HOUR }
            }),
            10 * MINUTE
        );
        assert.equal(
            getFreshMs("LEAGUE_TABLE", table, {
                now,
                matchWindow: { activeNow: false, nextEnd: null }
            }),
            DAY
        );
    });

    it("still shortens an empty schedule", () => {
        assert.equal(
            getFreshMs("LEAGUE_SCHEDULE", { data: { meetings: [] } }, { now }),
            EMPTY_RESULT_FRESH_MS
        );
    });
});

describe("stale limits", () => {
    it("keeps long lived entries usable for at least twice their freshness", () => {
        assert.ok(DATA_POLICIES.CLUB_HEAD.staleMax >= 60 * DAY);
        assert.ok(DATA_POLICIES.ANDRO_CLUB_NR.staleMax >= 60 * DAY);
    });

    it("serves live data fresh instead of stale-while-revalidate", () => {
        assert.equal(DATA_POLICIES.MEETING.swr, false);
        assert.equal(DATA_POLICIES.LEAGUE_TABLE.swr, true);
    });
});

describe("cache keys", () => {
    it("keeps the stored key formats", () => {
        assert.equal(cacheKeys.playerSearch("Max Muster", 1, 8), "players:max muster:1:8");
        assert.equal(cacheKeys.clubSearch("TTV", 2, 8), "clubs:ttv:2:8");
        assert.equal(cacheKeys.playerTtr("NU1"), "player-ttr:NU1");
        assert.equal(cacheKeys.playerTtrHistory("NU1"), "player-ttr-history:NU1");
        assert.equal(
            cacheKeys.playerTtrEstimate("NU1", "TTBW", "2055064", undefined),
            "player-ttr-estimate:NU1:TTBW:2055064:"
        );
        assert.equal(cacheKeys.playerClub("485630"), "player-club:485630");
        assert.equal(cacheKeys.clubHead("TTBW", "1"), "club-head:TTBW:1");
        assert.equal(cacheKeys.clubInfo("TTBW", "1", "26--27"), "club-info:TTBW:1:26--27");
        assert.equal(cacheKeys.clubTeams("TTBW", "1"), "club-teams:TTBW:1");
        assert.equal(cacheKeys.clubPlayers(" ttbw ", " 1 ", undefined), "club-players-andro:TTBW:1:");
        assert.equal(cacheKeys.clubPlayersByName("k", "TTV Abc"), "k:ttv abc");
        assert.equal(
            cacheKeys.clubSchedule({
                organization: "TTBW",
                clubNumber: "1",
                season: "26--27",
                clubSlug: "x"
            }),
            "club-schedule:TTBW:1:26--27:x::"
        );
        assert.equal(cacheKeys.leagueRegions("TTBW", "26--27"), "league-regions:v2:TTBW:26--27");
        assert.equal(
            cacheKeys.leagueClasses("TTBW", "26--27", "ligen", "bwttv"),
            "league-classes:TTBW:26--27:ligen:bwttv"
        );
        assert.equal(
            cacheKeys.leagueTable("TTBW", "26--27", "9", "x", "gesamt"),
            "league-table:TTBW:26--27:9:x:gesamt"
        );
        assert.equal(
            cacheKeys.leagueSchedule("TTBW", "26--27", "9", "x", "vr"),
            "league-schedule:TTBW:26--27:9:x:vr"
        );
        assert.equal(cacheKeys.teamPlayers("5"), "team-players:5");
        assert.equal(cacheKeys.teamSimpleSchedule("5", "26--27"), "team-simple-schedule:5:26--27");

        const team = {
            association: "TTBW",
            season: "26--27",
            groupId: "9",
            leagueSlug: "x",
            teamId: "5",
            teamNameSlug: "y"
        };

        assert.equal(cacheKeys.teamInfos(team), "team-infos:TTBW:26--27:9:x:5:y");
        assert.equal(cacheKeys.teamSchedule(team, "gesamt"), "team-schedule:TTBW:26--27:9:x:5:y:gesamt");
        assert.equal(cacheKeys.teamBalances(team, "rr"), "team-balances:TTBW:26--27:9:x:5:y:rr");
        assert.equal(cacheKeys.meetingLive("77"), "meeting-live:77");
        assert.equal(cacheKeys.eventsList(), "events:list");
        assert.equal(cacheKeys.eventsDetail("ABC"), "events:detail:abc");
    });
});
