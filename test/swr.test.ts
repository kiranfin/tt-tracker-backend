import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ResilientCache } from "../src/cache/resilientCache.js";

function createCache() {
    const clock = { now: 1_000_000 };

    const cache = new ResilientCache({
        maxEntries: 100,
        staleMaxAgeMs: 60_000,
        failedLoadRetryMs: 5_000,
        now: () => clock.now
    });

    return { cache, clock };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("ResilientCache stale-while-revalidate", () => {
    it("serves an expired entry at once and plans exactly one refresh", async () => {
        const { cache, clock } = createCache();
        let loads = 0;
        let release: () => void = () => {};
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });

        const params = {
            key: "k",
            ttlMs: 1000,
            swr: true,
            load: async () => {
                loads += 1;

                if (loads > 1) {
                    await gate;
                }

                return loads;
            }
        };

        await cache.readThrough(params);
        clock.now += 2000;

        const first = await cache.readThrough(params);
        const second = await cache.readThrough(params);

        assert.equal(first.source, "cache");
        assert.equal(first.value, 1);
        assert.equal(second.value, 1);
        assert.equal(loads, 2, "one initial load plus exactly one refresh");

        release();
        await tick();

        const fresh = await cache.readThrough(params);

        assert.equal(fresh.source, "cache");
        assert.equal(fresh.value, 2);
        assert.equal(loads, 2);
    });

    it("keeps the real fetchedAt of the served entry", async () => {
        const { cache, clock } = createCache();
        const params = { key: "k", ttlMs: 1000, swr: true, load: async () => "v" };

        const loaded = await cache.readThrough(params);
        clock.now += 5000;
        const served = await cache.readThrough(params);

        assert.equal(served.fetchedAt, loaded.fetchedAt);
    });

    it("uses the refresh load for the background update", async () => {
        const { cache, clock } = createCache();
        const calls: string[] = [];

        const params = {
            key: "k",
            ttlMs: 1000,
            swr: true,
            load: async () => {
                calls.push("load");
                return 1;
            },
            refreshLoad: async () => {
                calls.push("refresh");
                return 2;
            }
        };

        await cache.readThrough(params);
        clock.now += 2000;
        await cache.readThrough(params);
        await tick();

        assert.deepEqual(calls, ["load", "refresh"]);
    });

    it("waits for the load on a real miss, even with swr", async () => {
        const { cache } = createCache();

        const result = await cache.readThrough({
            key: "k",
            ttlMs: 1000,
            swr: true,
            load: async () => "first"
        });

        assert.equal(result.source, "upstream");
    });

    it("waits for the load when the entry is older than its stale limit", async () => {
        const { cache, clock } = createCache();
        const params = {
            key: "k",
            ttlMs: 1000,
            swr: true,
            staleMaxMs: 5000,
            load: async () => clock.now
        };

        await cache.readThrough(params);
        clock.now += 6000;

        const result = await cache.readThrough(params);

        assert.equal(result.source, "upstream");
        assert.equal(result.value, clock.now);
    });

    it("keeps serving the old entry and pauses retries when the refresh fails", async () => {
        const { cache, clock } = createCache();
        let loads = 0;

        const params = {
            key: "k",
            ttlMs: 1000,
            swr: true,
            load: async () => {
                loads += 1;

                if (loads > 1) {
                    throw new Error("down");
                }

                return "old";
            }
        };

        await cache.readThrough(params);
        clock.now += 2000;

        const first = await cache.readThrough(params);
        await tick();
        const second = await cache.readThrough(params);

        assert.equal(first.value, "old");
        assert.equal(second.value, "old");
        assert.equal(second.source, "stale");
        assert.equal(loads, 2, "no second attempt during the retry cooldown");
        assert.equal(cache.status().refreshFailures, 1);
    });

    it("does not refresh without swr but still falls back on errors", async () => {
        const { cache, clock } = createCache();
        let loads = 0;

        const params = {
            key: "k",
            ttlMs: 1000,
            load: async () => {
                loads += 1;

                if (loads > 1) {
                    throw new Error("down");
                }

                return "old";
            }
        };

        await cache.readThrough(params);
        clock.now += 2000;

        const result = await cache.readThrough(params);

        assert.equal(result.source, "stale");
        assert.equal(loads, 2);
    });

    it("lets one entry stay usable longer than the global stale limit", async () => {
        const { cache, clock } = createCache();

        await cache.readThrough({
            key: "k",
            ttlMs: 1000,
            staleMaxMs: 10 * 60_000,
            load: async () => "long lived"
        });
        clock.now += 5 * 60_000;

        assert.equal(cache.peekUsable("k"), "long lived");
    });
});
