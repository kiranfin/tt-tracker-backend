import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    findPlayerInClubList,
    normalizePlayerId,
    toPublicRating
} from "../src/mytt/rating.js";
import type { ClubPlayer } from "../src/schemas.js";

const PLAYERS: ClubPlayer[] = [
    { person_id: "NU485630", internal_id: "NU485630", ttr: 1612 },
    { person_id: "NU1478864", internal_id: "NU1478864", ttr: "1544" },
    { person_id: "NU99", internal_id: "NU99", ttr: null }
];

describe("normalizePlayerId", () => {
    it("ignores the NU prefix, case and whitespace", () => {
        assert.equal(normalizePlayerId(" nu485630 "), "485630");
        assert.equal(normalizePlayerId("485630"), "485630");
        assert.equal(normalizePlayerId(null), "");
    });
});

describe("findPlayerInClubList", () => {
    it("finds a player with and without prefix", () => {
        assert.equal(findPlayerInClubList(PLAYERS, "NU485630")?.ttr, 1612);
        assert.equal(findPlayerInClubList(PLAYERS, "1478864")?.ttr, "1544");
    });

    it("returns null for unknown or empty ids", () => {
        assert.equal(findPlayerInClubList(PLAYERS, "NU1"), null);
        assert.equal(findPlayerInClubList(PLAYERS, ""), null);
    });
});

describe("toPublicRating", () => {
    it("builds a public rating with the load time", () => {
        const rating = toPublicRating(PLAYERS[1]!, "2026-10-30T10:00:00.000Z");

        assert.deepEqual(rating, {
            value: 1544,
            source: "public",
            asOf: "2026-10-30T10:00:00.000Z"
        });
    });

    it("returns null without a ttr value", () => {
        assert.equal(toPublicRating(PLAYERS[2]!, "2026-10-30T10:00:00.000Z"), null);
    });
});
