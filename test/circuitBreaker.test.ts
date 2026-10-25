import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CircuitBreaker } from "../src/upstream/circuitBreaker.js";

function createBreaker() {
    const clock = { now: 0 };

    const breaker = new CircuitBreaker({
        baseBackoffMs: 60_000,
        maxBackoffMs: 600_000,
        serverErrorThreshold: 3,
        now: () => clock.now
    });

    return { breaker, clock };
}

describe("CircuitBreaker", () => {
    it("opens for the Retry-After duration on a 429", () => {
        const { breaker } = createBreaker();

        breaker.report({ status: 429, retryAfterHeader: "30" });

        assert.equal(breaker.remainingMs(), 30_000);
        assert.equal(breaker.status().state, "open");
    });

    it("uses exponential backoff without Retry-After, capped at the maximum", () => {
        const { breaker, clock } = createBreaker();
        const pauses: number[] = [];

        for (let i = 0; i < 6; i += 1) {
            breaker.report({ status: 429 });
            pauses.push(breaker.remainingMs());
            clock.now += breaker.remainingMs();
        }

        assert.deepEqual(pauses, [60_000, 120_000, 240_000, 480_000, 600_000, 600_000]);
    });

    it("resets the backoff after a successful response", () => {
        const { breaker, clock } = createBreaker();

        breaker.report({ status: 429 });
        clock.now += breaker.remainingMs();
        breaker.report({ status: 200 });
        breaker.report({ status: 429 });

        assert.equal(breaker.remainingMs(), 60_000);
    });

    it("opens only after several server errors in a row", () => {
        const { breaker } = createBreaker();

        breaker.report({ status: 503 });
        breaker.report({ networkError: true });
        assert.equal(breaker.remainingMs(), 0);

        breaker.report({ status: 500 });
        assert.equal(breaker.remainingMs(), 60_000);
    });

    it("a successful response interrupts the server error streak", () => {
        const { breaker } = createBreaker();

        breaker.report({ status: 503 });
        breaker.report({ status: 503 });
        breaker.report({ status: 200 });
        breaker.report({ status: 503 });

        assert.equal(breaker.remainingMs(), 0);
    });

    it("does not count client errors as failures", () => {
        const { breaker } = createBreaker();

        for (let i = 0; i < 10; i += 1) {
            breaker.report({ status: 404 });
        }

        assert.equal(breaker.remainingMs(), 0);
    });
});
