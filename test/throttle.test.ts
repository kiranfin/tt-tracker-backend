import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LocalRateLimitError } from "../src/upstream/errors.js";
import { RequestWindow } from "../src/upstream/requestWindow.js";
import { Throttle } from "../src/upstream/throttle.js";

const baseOptions = {
    maxConcurrent: 2,
    minIntervalMs: 0,
    queueTimeoutMs: 1000,
    maxQueueLength: 10
};

describe("Throttle", () => {
    it("never runs more than maxConcurrent requests at once", async () => {
        const throttle = new Throttle(baseOptions);
        let active = 0;
        let maxActive = 0;

        await Promise.all(
            Array.from({ length: 6 }, async () => {
                const release = await throttle.acquire();
                active += 1;
                maxActive = Math.max(maxActive, active);
                await new Promise((resolve) => setTimeout(resolve, 10));
                active -= 1;
                release();
            })
        );

        assert.equal(maxActive, 2);
    });

    it("spaces request starts by the minimum interval", async () => {
        const throttle = new Throttle({ ...baseOptions, maxConcurrent: 5, minIntervalMs: 40 });
        const startedAt: number[] = [];

        await Promise.all(
            Array.from({ length: 4 }, async () => {
                const release = await throttle.acquire();
                startedAt.push(Date.now());
                release();
            })
        );

        for (let i = 1; i < startedAt.length; i += 1) {
            assert.ok(startedAt[i] - startedAt[i - 1] >= 35, "starts are spaced");
        }
    });

    it("rejects with queue_full when the queue is too long", async () => {
        const throttle = new Throttle({ ...baseOptions, maxConcurrent: 1, maxQueueLength: 1 });

        const first = await throttle.acquire();
        const waiting = throttle.acquire();

        await assert.rejects(
            throttle.acquire(),
            (error: unknown) =>
                error instanceof LocalRateLimitError && error.reason === "queue_full"
        );

        first();
        (await waiting)();
    });

    it("rejects waiters when the guard throws at dispatch time", async () => {
        let blocked = false;

        const throttle = new Throttle({
            ...baseOptions,
            maxConcurrent: 1,
            guard: () => {
                if (blocked) {
                    throw new LocalRateLimitError(1000, "breaker_open");
                }
            }
        });

        const first = await throttle.acquire();
        const waiting = throttle.acquire();

        blocked = true;
        first();

        await assert.rejects(
            waiting,
            (error: unknown) =>
                error instanceof LocalRateLimitError && error.reason === "breaker_open"
        );
    });
});

describe("RequestWindow", () => {
    it("blocks once the hourly cap is reached and recovers after an hour", () => {
        const clock = { now: 0 };
        const window = new RequestWindow(2, () => clock.now);

        window.record();
        window.record();

        assert.throws(
            () => window.assertAvailable(),
            (error: unknown) =>
                error instanceof LocalRateLimitError && error.reason === "hourly_cap"
        );

        clock.now += 60 * 60 * 1000 + 1;
        assert.doesNotThrow(() => window.assertAvailable());
    });

    it("treats 0 as unlimited", () => {
        const window = new RequestWindow(0);

        for (let i = 0; i < 5000; i += 1) {
            window.record();
        }

        assert.doesNotThrow(() => window.assertAvailable());
        assert.equal(window.status().remaining, null);
    });
});
