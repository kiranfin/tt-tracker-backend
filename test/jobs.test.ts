import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { putCached } from "../src/cache/index.js";
import { cacheKeys } from "../src/cacheKeys.js";
import { getClubLogos } from "../src/services/club.js";
import { scheduleBackground, whenBackgroundIdle } from "../src/services/jobs.js";
import { getUpstreamPriority } from "../src/upstream/priority.js";
import { reportUpstreamResult, resetBreakersForTests } from "../src/upstream/rateLimiter.js";

describe("background jobs", () => {
    it("runs jobs one after another with background priority", async () => {
        resetBreakersForTests();

        const log: string[] = [];

        const run = (name: string) => async () => {
            log.push(`${name}:start:${getUpstreamPriority()}`);
            await new Promise((resolve) => setTimeout(resolve, 5));
            log.push(`${name}:end`);
        };

        assert.equal(scheduleBackground("a", run("a")), true);
        assert.equal(scheduleBackground("b", run("b")), true);

        await whenBackgroundIdle();

        assert.deepEqual(log, ["a:start:background", "a:end", "b:start:background", "b:end"]);
    });

    it("runs a job per key only once at a time", async () => {
        resetBreakersForTests();

        let runs = 0;
        const run = async () => {
            runs += 1;
        };

        assert.equal(scheduleBackground("same", run), true);
        assert.equal(scheduleBackground("same", run), false);

        await whenBackgroundIdle();

        assert.equal(runs, 1);
        assert.equal(scheduleBackground("same", run), true, "free again after it finished");

        await whenBackgroundIdle();
    });

    it("survives a failing job", async () => {
        resetBreakersForTests();

        let second = false;

        scheduleBackground("fails", async () => {
            throw new Error("boom");
        });
        scheduleBackground("works", async () => {
            second = true;
        });

        await whenBackgroundIdle();

        assert.equal(second, true);
    });

    it("plans nothing while myTischtennis blocks the server", () => {
        resetBreakersForTests();
        reportUpstreamResult({ lane: "api", challenge: true });

        assert.equal(scheduleBackground("blocked", async () => undefined), false);

        resetBreakersForTests();
    });
});

describe("club logos", () => {
    it("answers from the cache only and lists the missing logos as pending", () => {
        resetBreakersForTests();
        // Eine Challenge verhindert, dass die Hintergrundjobs dieses Tests echte Abrufe starten.
        reportUpstreamResult({ lane: "api", challenge: true });

        putCached(cacheKeys.clubHead("TTBW", "2055064"), { logoUrl: "https://logo/1" }, 60_000);
        putCached(cacheKeys.clubHead("TTBW", "2055099"), { logoUrl: null }, 60_000);

        const result = getClubLogos(["TTBW:2055064", "TTBW:2055099", "WTTV:12201"]);

        assert.deepEqual(result.logos, {
            "TTBW:2055064": "https://logo/1",
            "TTBW:2055099": null
        });
        assert.deepEqual(result.pending, ["WTTV:12201"]);

        resetBreakersForTests();
    });
});
