import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { markLoadOrigin } from "../src/cache/loadOrigin.js";
import { ResilientCache } from "../src/cache/resilientCache.js";

function createCache(overrides?: { maxEntries?: number; staleMaxAgeMs?: number }) {
    const clock = { now: 1_000_000 };

    const cache = new ResilientCache({
        maxEntries: overrides?.maxEntries ?? 100,
        staleMaxAgeMs: overrides?.staleMaxAgeMs ?? 60_000,
        failedLoadRetryMs: 5_000,
        now: () => clock.now
    });

    return { cache, clock };
}

describe("ResilientCache", () => {
    it("serves a fresh entry without loading again", async () => {
        const { cache } = createCache();
        let loads = 0;
        const load = async () => ++loads;

        const first = await cache.readThrough({ key: "k", ttlMs: 1000, load });
        const second = await cache.readThrough({ key: "k", ttlMs: 1000, load });

        assert.equal(first.source, "upstream");
        assert.equal(second.source, "cache");
        assert.equal(second.value, 1);
        assert.equal(loads, 1);
    });

    it("shares one load between concurrent callers", async () => {
        const { cache } = createCache();
        let loads = 0;

        const load = async () => {
            loads += 1;
            await new Promise((resolve) => setTimeout(resolve, 10));
            return "value";
        };

        const results = await Promise.all(
            Array.from({ length: 20 }, () => cache.readThrough({ key: "k", ttlMs: 1000, load }))
        );

        assert.equal(loads, 1);
        assert.ok(results.every((result) => result.value === "value"));
        assert.equal(cache.status().deduped, 19);
    });

    it("serves a stale entry when the load fails", async () => {
        const { cache, clock } = createCache();

        await cache.readThrough({ key: "k", ttlMs: 1000, load: async () => "old" });
        clock.now += 2000;

        const result = await cache.readThrough({
            key: "k",
            ttlMs: 1000,
            load: async () => {
                throw new Error("upstream down");
            }
        });

        assert.equal(result.source, "stale");
        assert.equal(result.value, "old");
    });

    it("does not retry a failing source during the retry cooldown", async () => {
        const { cache, clock } = createCache();
        let loads = 0;

        const failing = async (): Promise<string> => {
            loads += 1;
            throw new Error("down");
        };

        await cache.readThrough({ key: "k", ttlMs: 1000, load: async () => "old" });
        clock.now += 2000;

        await cache.readThrough({ key: "k", ttlMs: 1000, load: failing });
        await cache.readThrough({ key: "k", ttlMs: 1000, load: failing });
        assert.equal(loads, 1);

        clock.now += 5000;
        await cache.readThrough({ key: "k", ttlMs: 1000, load: failing });
        assert.equal(loads, 2);
    });

    it("throws when the load fails and nothing usable is cached", async () => {
        const { cache, clock } = createCache({ staleMaxAgeMs: 10_000 });

        await assert.rejects(
            cache.readThrough({
                key: "missing",
                ttlMs: 1000,
                load: async () => {
                    throw new Error("boom");
                }
            }),
            /boom/
        );

        await cache.readThrough({ key: "k", ttlMs: 1000, load: async () => "old" });
        clock.now += 20_000;

        await assert.rejects(
            cache.readThrough({
                key: "k",
                ttlMs: 1000,
                load: async () => {
                    throw new Error("boom");
                }
            }),
            /boom/
        );
    });

    it("reports html when the load used the fallback source", async () => {
        const { cache } = createCache();

        const result = await cache.readThrough({
            key: "k",
            ttlMs: 1000,
            load: async () => {
                markLoadOrigin("html");
                return "from page";
            }
        });

        assert.equal(result.source, "html");
    });

    it("derives the ttl from the loaded value", async () => {
        const { cache, clock } = createCache();

        await cache.readThrough({
            key: "k",
            ttlMs: (value: { live: boolean }) => (value.live ? 100 : 10_000),
            load: async () => ({ live: true })
        });

        clock.now += 500;

        const result = await cache.readThrough({
            key: "k",
            ttlMs: 100,
            load: async () => ({ live: false })
        });

        assert.equal(result.source, "upstream");
    });

    it("evicts the oldest entries beyond the size limit", async () => {
        const { cache } = createCache({ maxEntries: 2 });

        cache.set("a", 1, 1000);
        cache.set("b", 2, 1000);
        cache.set("c", 3, 1000);

        assert.equal(cache.status().entries, 2);
        assert.deepEqual(
            cache.snapshot().map(([key]) => key),
            ["b", "c"]
        );
    });

    it("restores persisted entries as stale data", async () => {
        const { cache: original } = createCache();
        original.set("k", "persisted", 1000);

        const { cache: restored, clock } = createCache();
        restored.restore(original.snapshot());
        clock.now += 5000;

        const result = await restored.readThrough({
            key: "k",
            ttlMs: 1000,
            load: async () => {
                throw new Error("offline");
            }
        });

        assert.equal(result.source, "stale");
        assert.equal(result.value, "persisted");
    });
});
