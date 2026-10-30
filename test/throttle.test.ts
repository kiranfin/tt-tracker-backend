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

describe("Throttle priorities", () => {
    it("serves interactive requests before waiting background requests", async () => {
        const throttle = new Throttle({ ...baseOptions, maxConcurrent: 1 });
        const order: string[] = [];

        const first = await throttle.acquire("interactive");

        const background = throttle.acquire("background").then((release) => {
            order.push("background");
            release();
        });
        const interactive = throttle.acquire("interactive").then((release) => {
            order.push("interactive");
            release();
        });

        first();
        await Promise.all([background, interactive]);

        assert.deepEqual(order, ["interactive", "background"]);
    });

    it("never lets background requests take all slots", async () => {
        const throttle = new Throttle({ ...baseOptions, maxConcurrent: 3 });
        const held: Array<() => void> = [];

        for (let i = 0; i < 5; i += 1) {
            void throttle
                .acquire("background")
                .then((release) => held.push(release))
                .catch(() => undefined);
        }

        await new Promise((resolve) => setTimeout(resolve, 20));

        assert.equal(held.length, 2);
        assert.equal(throttle.status().activeBackground, 2);

        // Ein Nutzer findet sofort einen Platz.
        const release = await throttle.acquire("interactive");

        assert.equal(throttle.status().active, 3);

        release();

        // Die übrigen Wartenden rücken nach und werden hier nicht mehr gebraucht.
        while (held.length > 0) {
            held.pop()!();
            await new Promise((resolve) => setTimeout(resolve, 1));
        }
    });

    it("reports both queues separately", async () => {
        const throttle = new Throttle({ ...baseOptions, maxConcurrent: 1 });
        const first = await throttle.acquire("interactive");

        const pending = [throttle.acquire("interactive"), throttle.acquire("background")].map(
            (acquired) => acquired.then((release) => release())
        );

        const status = throttle.status();

        assert.equal(status.waitingInteractive, 1);
        assert.equal(status.waitingBackground, 1);
        assert.equal(status.waiting, 2);

        first();

        await Promise.all(pending);
    });

    it("gives background requests their own longer timeout", async () => {
        const throttle = new Throttle({
            ...baseOptions,
            maxConcurrent: 1,
            queueTimeoutMs: 20,
            backgroundQueueTimeoutMs: 200
        });
        const first = await throttle.acquire("interactive");

        const interactive = throttle.acquire("interactive");
        const background = throttle.acquire("background");

        await assert.rejects(interactive, LocalRateLimitError);

        first();
        (await background)();
    });
});

describe("Throttle pace", () => {
    const paced = { ...baseOptions, minIntervalMs: 100, maxIntervalMs: 400 };

    it("doubles the interval on slowDown up to the maximum", () => {
        const throttle = new Throttle(paced);

        assert.equal(throttle.status().currentIntervalMs, 100);

        assert.deepEqual(throttle.slowDown(), { from: 100, to: 200 });
        assert.deepEqual(throttle.slowDown(), { from: 200, to: 400 });
        assert.equal(throttle.slowDown(), null);
        assert.equal(throttle.status().currentIntervalMs, 400);
    });

    it("shrinks by 20 percent only after a success streak and never below the minimum", () => {
        const throttle = new Throttle(paced);

        throttle.slowDown();
        throttle.slowDown();

        for (let i = 0; i < 24; i += 1) {
            assert.equal(throttle.recordSuccess(), null);
        }

        assert.deepEqual(throttle.recordSuccess(), { from: 400, to: 320 });

        for (let i = 0; i < 25; i += 1) {
            throttle.recordSuccess();
        }
        assert.equal(throttle.status().currentIntervalMs, 256);

        // Weiter schrumpfen bis zum Minimum, dann bleibt es dort.
        for (let i = 0; i < 25 * 10; i += 1) {
            throttle.recordSuccess();
        }

        assert.equal(throttle.status().currentIntervalMs, 100);
    });

    it("restarts the success streak after a slowDown", () => {
        const throttle = new Throttle(paced);

        throttle.slowDown();

        for (let i = 0; i < 20; i += 1) {
            throttle.recordSuccess();
        }

        throttle.slowDown();

        for (let i = 0; i < 24; i += 1) {
            assert.equal(throttle.recordSuccess(), null);
        }

        assert.equal(throttle.status().currentIntervalMs, 400);
    });
});
