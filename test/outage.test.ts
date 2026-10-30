import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readThrough } from "../src/cache/index.js";
import { detectUpstreamOutage } from "../src/mytt/request.js";
import { fetchWithFallback } from "../src/sources/fetchWithFallback.js";
import { searchKnownClubs, searchKnownPlayers } from "../src/sources/knownSearch.js";
import { CircuitBreaker } from "../src/upstream/circuitBreaker.js";
import { LocalRateLimitError } from "../src/upstream/errors.js";
import {
    getRateLimitStatus,
    getUpstreamLane,
    parseRateLimitHeader,
    reportUpstreamResult,
    resetBreakersForTests
} from "../src/upstream/rateLimiter.js";

function jsonResponse(status: number, headers: Record<string, string> = {}) {
    return new Response(null, { status, headers });
}

describe("detectUpstreamOutage", () => {
    it("detects a PostgREST database error inside a 200 response", () => {
        const body = JSON.stringify({
            ttr: null,
            error: {
                code: "PGRST002",
                message: "Could not query the database for the schema cache. Retrying."
            }
        });

        assert.match(detectUpstreamOutage(jsonResponse(200), body) ?? "", /PGRST002/);
    });

    it("detects the database error string the search returns with a 400", () => {
        const body = JSON.stringify({
            error: "Could not query the database for the schema cache. Retrying."
        });

        assert.ok(detectUpstreamOutage(jsonResponse(400), body));
    });

    it("detects a refused database connection in both payload shapes", () => {
        const reason =
            "FetchError: request to http://10.0.0.11:8000/rest/v1/rpc/search_players failed, reason: connect ECONNREFUSED 10.0.0.11:8000";

        assert.ok(detectUpstreamOutage(jsonResponse(400), JSON.stringify({ error: reason })));
        assert.ok(
            detectUpstreamOutage(
                jsonResponse(200),
                JSON.stringify({ data: null, error: { message: reason, details: reason, hint: "", code: "" } })
            )
        );
    });

    it("detects a crashed Remix loader", () => {
        const body = JSON.stringify({ message: "Unexpected Server Error" });

        assert.ok(detectUpstreamOutage(jsonResponse(400, { "x-remix-error": "yes" }), body));
    });

    it("ignores normal data, auth errors and PostgREST not found codes", () => {
        assert.equal(detectUpstreamOutage(jsonResponse(200), JSON.stringify({ ttr: 1500 })), null);
        assert.equal(
            detectUpstreamOutage(jsonResponse(200), JSON.stringify({ error: { code: "PGRST116" } })),
            null
        );
        assert.equal(
            detectUpstreamOutage(jsonResponse(200), JSON.stringify({ error: "not logged in" })),
            null
        );
        assert.equal(detectUpstreamOutage(jsonResponse(200), "<html>"), null);
    });
});

describe("myTischtennis quota and lanes", () => {
    it("reads the ratelimit header", () => {
        const quota = parseRateLimitHeader('"360-in-30min"; r=338; t=1504', 0);

        assert.deepEqual(quota, { limit: 360, remaining: 338, resetAt: 1_504_000 });
        assert.equal(parseRateLimitHeader(null), null);
        assert.equal(parseRateLimitHeader("garbage"), null);
    });

    it("puts the JSON API and the web pages into separate lanes", () => {
        assert.equal(getUpstreamLane("/api/search/players"), "api");
        assert.equal(getUpstreamLane("/api/ttr/history/NU1"), "api");
        assert.equal(getUpstreamLane("/click-tt/TTBW/26--27/verein/1/x/spielplan"), "site");
        assert.equal(getUpstreamLane("/rankings/andro-rangliste"), "site");
    });

    it("tells rate limits apart from outages and keeps a longer pause", () => {
        const clock = { now: 0 };
        const breaker = new CircuitBreaker({
            baseBackoffMs: 60_000,
            maxBackoffMs: 600_000,
            serverErrorThreshold: 1,
            now: () => clock.now
        });

        breaker.report({ networkError: true });
        assert.equal(breaker.isRateLimited(), false);

        breaker.pauseFor("upstream_quota", 30_000);
        assert.equal(breaker.remainingMs(), 60_000, "shorter quota pause must not cut the outage pause");

        breaker.pauseFor("upstream_quota", 1_800_000);
        assert.equal(breaker.remainingMs(), 600_000);
        assert.equal(breaker.isRateLimited(), true);
    });
});

describe("429 handling per lane", () => {
    it("pauses both lanes on a real quota 429 (with ratelimit header)", () => {
        resetBreakersForTests();

        reportUpstreamResult({
            lane: "site",
            status: 429,
            rateLimitHeader: '"360-in-30min"; r=0; t=120'
        });

        const { breaker } = getRateLimitStatus();

        assert.equal(breaker.site.state, "open");
        assert.equal(breaker.api.state, "open");
        assert.ok(breaker.api.retryAfterSeconds >= 118 && breaker.api.retryAfterSeconds <= 120);

        resetBreakersForTests();
    });

    it("pauses only the lane of a 429 without ratelimit header", () => {
        resetBreakersForTests();

        reportUpstreamResult({ lane: "api", status: 429 });

        const { breaker } = getRateLimitStatus();

        assert.equal(breaker.api.state, "open");
        assert.equal(breaker.site.state, "closed");

        resetBreakersForTests();
    });

    it("pauses only one lane after repeated 5xx", () => {
        resetBreakersForTests();

        for (let i = 0; i < 3; i += 1) {
            reportUpstreamResult({ lane: "api", status: 503 });
        }

        const { breaker } = getRateLimitStatus();

        assert.equal(breaker.api.state, "open");
        assert.equal(breaker.site.state, "closed");

        resetBreakersForTests();
    });
});

describe("fallback during an outage", () => {
    it("tries the web page when only the API lane is paused", async () => {
        const value = await fetchWithFallback({
            name: "test_outage_lane",
            primary: async () => {
                throw new LocalRateLimitError(1000, "upstream_unavailable");
            },
            fallback: async () => "html"
        });

        assert.equal(value, "html");
    });
});

describe("known results search", () => {
    it("finds players and clubs that are already in the cache", async () => {
        await readThrough({
            key: "test:players",
            ttlMs: 60_000,
            load: async () => ({
                results: [
                    {
                        firstname: "Sebastian",
                        lastname: "Schwarz",
                        internal_id: "NU123",
                        club_name: "TTV Pleidelsheim"
                    },
                    { firstname: "Anna", lastname: "Müller", internal_id: "NU456" }
                ]
            })
        });

        await readThrough({
            key: "test:team-players",
            ttlMs: 60_000,
            load: async () => ({
                data: [{ firstname: "Sebastian", lastname: "Schwarz", internal_id: "NU123" }]
            })
        });

        await readThrough({
            key: "test:clubs",
            ttlMs: 60_000,
            load: async () => ({
                results: [{ clubname: "TTV Pleidelsheim", clubnr: "2055064", organization_id: 1 }]
            })
        });

        const players = searchKnownPlayers({ query: "sebastian schw", page: 1, pagesize: 8 });

        assert.equal(players.total_count, 1);
        assert.equal(players.results[0]?.club_name, "TTV Pleidelsheim");

        assert.equal(searchKnownPlayers({ query: "mueller", page: 1, pagesize: 8 }).total_count, 1);
        assert.equal(searchKnownPlayers({ query: "nobody", page: 1, pagesize: 8 }).total_count, 0);

        assert.equal(searchKnownClubs({ query: "pleidels", page: 1, pagesize: 8 }).total_count, 1);
    });
});
