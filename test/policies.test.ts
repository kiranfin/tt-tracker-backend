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

describe("data policies", () => {
    it("gives every kind a usable policy", () => {
        for (const [kind, policy] of Object.entries(DATA_POLICIES)) {
            assert.ok(policy.staleMax > 0, `${kind} staleMax`);
            assert.ok(["interactive", "background"].includes(policy.priority), `${kind} priority`);
            assert.ok(typeof policy.fresh === "function" || policy.fresh > 0, `${kind} fresh`);
        }
    });

    it("keeps the TTLs the routes used before the refactoring", () => {
        const fixed: Array<[DataKind, number]> = [
            ["PLAYER_SEARCH", 5 * MINUTE],
            ["CLUB_SEARCH", 15 * MINUTE],
            ["PLAYER_TTR", 30 * MINUTE],
            ["PLAYER_TTR_HISTORY", HOUR],
            ["CLUB_TEAMS", HOUR],
            ["CLUB_INFO", 12 * HOUR],
            ["CLUB_HEAD", 7 * 24 * HOUR],
            ["ANDRO_CLUB_NR", 24 * HOUR],
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
        assert.equal(getFreshMs("LEAGUE_REGIONS", { regions: [1] }), 6 * HOUR);
        assert.equal(getFreshMs("LEAGUE_CLASSES", { classes: [] }), EMPTY_RESULT_FRESH_MS);
        assert.equal(getFreshMs("LEAGUE_CLASSES", { classes: [1] }), HOUR);
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
        assert.equal(getFreshMs("MEETING", { data: { live: true } }), 30_000);
        assert.equal(getFreshMs("MEETING", { data: { live: false } }), 2 * MINUTE);
        assert.equal(getFreshMs("MEETING", { data: { is_completed: true } }), MEETING_COMPLETED_FRESH_MS);
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
