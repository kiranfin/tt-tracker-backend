import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { putCached } from "../src/cache/index.js";
import { cacheKeys, kindOfKey } from "../src/cacheKeys.js";
import { rotateLogFiles } from "../src/fileLogger.js";
import { DATA_POLICIES } from "../src/policies.js";
import { getDataStatus } from "../src/services/status.js";
import { runWithDataKind } from "../src/upstream/dataKind.js";
import { trackUpstreamRequest } from "../src/upstream/tracker.js";

describe("log rotation", () => {
    let dir: string;

    before(async () => {
        dir = await mkdtemp(join(tmpdir(), "tttracker-log-"));
    });

    after(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it("passes the files on and drops the oldest", async () => {
        const file = join(dir, "requests.jsonl");

        await writeFile(file, "current");
        await writeFile(`${file}.1`, "one");
        await writeFile(`${file}.2`, "two");
        await writeFile(`${file}.3`, "three");

        await rotateLogFiles(file, 3);

        assert.equal(await readFile(`${file}.1`, "utf8"), "current");
        assert.equal(await readFile(`${file}.2`, "utf8"), "one");
        assert.equal(await readFile(`${file}.3`, "utf8"), "two");

        const files = (await readdir(dir)).sort();

        assert.deepEqual(files, ["requests.jsonl.1", "requests.jsonl.2", "requests.jsonl.3"]);
    });

    it("works when there are no older files yet", async () => {
        const file = join(dir, "fresh.jsonl");

        await writeFile(file, "only");
        await rotateLogFiles(file, 3);

        assert.equal(await readFile(`${file}.1`, "utf8"), "only");
    });

    it("does not fail when the log file does not exist", async () => {
        await assert.doesNotReject(rotateLogFiles(join(dir, "missing.jsonl"), 3));
    });
});

describe("cache key kinds", () => {
    it("maps every key builder to a data kind with a policy", () => {
        const team = {
            association: "TTBW",
            season: "26--27",
            groupId: "9",
            leagueSlug: "x",
            teamId: "5",
            teamNameSlug: "y"
        };

        const keys = [
            cacheKeys.playerSearch("abc", 1, 8),
            cacheKeys.clubSearch("abc", 1, 8),
            cacheKeys.playerTtr("NU1"),
            cacheKeys.playerTtrHistory("NU1"),
            cacheKeys.playerTtrEstimate("NU1", "TTBW", "1"),
            cacheKeys.playerClub("1"),
            cacheKeys.clubHead("TTBW", "1"),
            cacheKeys.clubInfo("TTBW", "1", "26--27"),
            cacheKeys.clubTeams("TTBW", "1"),
            cacheKeys.clubPlayers("TTBW", "1"),
            cacheKeys.clubSchedule({ organization: "TTBW", clubNumber: "1", season: "26--27", clubSlug: "x" }),
            cacheKeys.androClubNr("TTBW", "1"),
            cacheKeys.leagueRegions("TTBW", "26--27"),
            cacheKeys.leagueClasses("TTBW", "26--27", "ligen", "x"),
            cacheKeys.leagueTable("TTBW", "26--27", "9", "x", "gesamt"),
            cacheKeys.leagueSchedule("TTBW", "26--27", "9", "x", "gesamt"),
            cacheKeys.teamPlayers("5"),
            cacheKeys.teamSimpleSchedule("5", "26--27"),
            cacheKeys.teamInfos(team),
            cacheKeys.teamSchedule(team, "gesamt"),
            cacheKeys.teamBalances(team, "gesamt"),
            cacheKeys.meetingLive("77"),
            cacheKeys.eventsList(),
            cacheKeys.eventsDetail("abc")
        ];

        const kinds = keys.map((key) => kindOfKey(key));

        assert.ok(kinds.every((kind) => kind && kind in DATA_POLICIES), `unmapped: ${keys.filter((_, i) => !kinds[i])}`);
        // Jede Datenart hat einen Key Builder.
        assert.deepEqual([...new Set(kinds)].sort(), Object.keys(DATA_POLICIES).sort());
        assert.equal(kindOfKey("unknown:thing"), null);
    });
});

describe("data status", () => {
    it("counts entries, ages and the next refresh per data kind", () => {
        const now = Date.now();

        putCached(cacheKeys.clubTeams("STAT", "1"), { teams: [] }, 60_000);
        putCached(cacheKeys.clubTeams("STAT", "2"), { teams: [] }, 120_000);
        putCached(cacheKeys.clubTeams("STAT", "3"), { teams: [] }, -1000);

        const status = getDataStatus(now);
        const teams = status.kinds.CLUB_TEAMS!;

        assert.equal(teams.entries, 3);
        assert.equal(teams.fresh, 2);
        assert.equal(teams.stale, 1);
        assert.ok(teams.nextRefreshAt && Date.parse(teams.nextRefreshAt) <= now + 61_000);
        assert.equal(status.kinds.LEAGUE_TABLE!.entries, 0);
        assert.equal(status.kinds.LEAGUE_TABLE!.nextRefreshAt, null);
    });

    it("attributes upstream requests to the data kind and priority", async () => {
        await runWithDataKind("LEAGUE_TABLE", async () => {
            trackUpstreamRequest({
                method: "GET",
                path: "/x",
                url: "http://x/x",
                ok: true,
                durationMs: 1,
                kind: "LEAGUE_TABLE",
                priority: "background"
            });
        });

        trackUpstreamRequest({ method: "GET", path: "/y", url: "http://x/y", ok: true, durationMs: 1 });

        const status = getDataStatus();

        assert.equal(status.kinds.LEAGUE_TABLE!.requestsLast30Min.background, 1);
        assert.equal(status.other.interactive, 1);
        assert.equal(status.budget.max, 90);
    });
});
