import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LeagueTableResponse } from "../src/schemas.js";
import {
    isEmptyClubSchedule,
    isEmptyLeagueSchedule,
    isEmptyLeagueTable,
    validateClubSchedule,
    validateLeagueSchedule,
    validateLeagueTable,
    validateTeamSchedule
} from "../src/sources/validate.js";
import { UpstreamFormatError } from "../src/upstream/errors.js";

function table(rows: LeagueTableResponse["data"]): LeagueTableResponse {
    return { data: rows, error: null };
}

const GOOD_ROW = {
    team_name: "Team A",
    table_rank: 1,
    meetings_count: 14,
    meetings_won: 12,
    meetings_tie: 1,
    meetings_lost: 1,
    points_won: 25
};

describe("validateLeagueTable", () => {
    it("accepts a consistent table", () => {
        const value = table([GOOD_ROW, { ...GOOD_ROW, team_name: "Team B", table_rank: "2" }]);

        assert.equal(validateLeagueTable(value, "t"), value);
    });

    it("rejects an empty table", () => {
        assert.throws(() => validateLeagueTable(table([]), "t"), UpstreamFormatError);
    });

    it("rejects rows without team name or numeric rank", () => {
        assert.throws(
            () => validateLeagueTable(table([{ ...GOOD_ROW, team_name: "" }]), "t"),
            UpstreamFormatError
        );
        assert.throws(
            () => validateLeagueTable(table([{ ...GOOD_ROW, table_rank: "x" }]), "t"),
            UpstreamFormatError
        );
    });

    it("allows excluded teams without a rank", () => {
        const value = table([GOOD_ROW, { team_name: "Out", table_rank: null, is_excluded: true }]);

        assert.equal(validateLeagueTable(value, "t"), value);
    });

    it("rejects S + U + N that differs from Beg.", () => {
        assert.throws(
            () => validateLeagueTable(table([{ ...GOOD_ROW, meetings_lost: 5 }]), "t"),
            /S \+ U \+ N/
        );
    });

    it("only warns about points that differ from 2*S + U", () => {
        const value = table([{ ...GOOD_ROW, points_won: 20 }]);

        assert.equal(validateLeagueTable(value, "t"), value);
    });

    it("reports an empty table", () => {
        assert.equal(isEmptyLeagueTable(table([])), true);
        assert.equal(isEmptyLeagueTable(table([GOOD_ROW])), false);
    });
});

const MEETING = { date: "2025-10-04T16:00:00.000+00:00", team_home: "A", team_away: "B" };

describe("meeting validation", () => {
    it("accepts a league schedule and treats no meetings as valid but empty", () => {
        const full = { data: { meetings: [{ "2025-10-04": [MEETING] }] } };
        const empty = { data: { meetings: [] } };

        assert.equal(validateLeagueSchedule(full, "t"), full);
        assert.equal(validateLeagueSchedule(empty, "t"), empty);
        assert.equal(isEmptyLeagueSchedule(full), false);
        assert.equal(isEmptyLeagueSchedule(empty), true);
    });

    it("rejects a meeting without date or teams", () => {
        const noDate = { data: { meetings: [{ "2025-10-04": [{ ...MEETING, date: null }] }] } };
        const noTeams = {
            data: { meetings: [{ "2025-10-04": [{ date: MEETING.date, team_home: null, team_away: "" }] }] }
        };

        assert.throws(() => validateLeagueSchedule(noDate, "t"), UpstreamFormatError);
        assert.throws(() => validateLeagueSchedule(noTeams, "t"), UpstreamFormatError);
    });

    it("accepts a meeting with only one team", () => {
        const value = { data: { meetings: [{ "2025-10-04": [{ ...MEETING, team_away: null }] }] } };

        assert.equal(validateLeagueSchedule(value, "t"), value);
    });

    it("reads team meetings from meetings_excerpt", () => {
        const good = {
            data: { schedule: [], meetings_excerpt: { meetings: [{ "2025-10-04": [MEETING] }] } }
        };
        const bad = {
            data: { schedule: [], meetings_excerpt: { meetings: [{ "2025-10-04": [{ x: 1 }] }] } }
        };

        assert.equal(validateTeamSchedule(good, "t"), good);
        assert.throws(() => validateTeamSchedule(bad, "t"), UpstreamFormatError);
    });

    it("reads club meetings from the flat list and from date keys", () => {
        const flat = { data: { meetings: [MEETING] } };
        const dated = { data: { meetings: [], "2026-09-18": [MEETING] } };
        const bad = { data: { meetings: [], "2026-09-18": [{ team_home: "A" }] } };
        const empty = { data: { meetings: [] } };

        assert.equal(validateClubSchedule(flat, "t"), flat);
        assert.equal(validateClubSchedule(dated, "t"), dated);
        assert.throws(() => validateClubSchedule(bad, "t"), UpstreamFormatError);
        assert.equal(isEmptyClubSchedule(flat), false);
        assert.equal(isEmptyClubSchedule(dated), false);
        assert.equal(isEmptyClubSchedule(empty), true);
    });
});
