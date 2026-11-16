import assert from "node:assert/strict";
import { afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { peekUsableCached, putCached } from "../src/cache/index.js";
import { cacheKeys } from "../src/cacheKeys.js";
import { config } from "../src/config.js";
import { requestContext, type RequestContext } from "../src/requestContext.js";
import type { RelayContext, RelayResponse } from "../src/relayTypes.js";
import { fetchWithFallback } from "../src/sources/fetchWithFallback.js";
import { getClubLogos } from "../src/services/club.js";
import { whenBackgroundIdle } from "../src/services/jobs.js";
import { getTeamPlayerList } from "../src/services/team.js";
import { readByPolicy } from "../src/services/read.js";
import { attachRelayRequests } from "../src/services/relay.js";
import { RelayRequiredError } from "../src/upstream/errors.js";
import { fetchUpstreamText, type UpstreamRequest } from "../src/upstream/fetch.js";
import { runInBackground } from "../src/upstream/priority.js";
import { getRateLimitStatus } from "../src/upstream/rateLimiter.js";
import {
    allowRelayUpload,
    getRelayStatus,
    relayFingerprint,
    resetRelayForTests,
    storeRelayResponses
} from "../src/upstream/relay.js";

const UPLOADER = "ip:10.0.0.1";
const BASE = config.upstream.baseUrl;

let realFetchCalls = 0;
const originalFetch = globalThis.fetch;

before(() => {
    globalThis.fetch = (async () => {
        realFetchCalls += 1;

        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
});

beforeEach(() => {
    realFetchCalls = 0;
    resetRelayForTests();
});

afterEach(() => {
    mock.restoreAll();
});

// Stellt den echten fetch nach dem letzten Test wieder her.
process.on("exit", () => {
    globalThis.fetch = originalFetch;
});

function relayState(uploader = UPLOADER): RelayContext {
    return { uploader, misses: [], served: 0 };
}

function context(relay?: RelayContext): RequestContext {
    return { requestId: "t", method: "GET", url: "/x", ip: "10.0.0.1", relay };
}

function upstreamRequest(
    path: string,
    params: Record<string, string> = {},
    overrides: Partial<UpstreamRequest> = {}
): UpstreamRequest {
    const url = new URL(`${BASE}${path}`);

    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
    }

    return {
        method: "GET",
        url,
        path,
        headers: { accept: "application/json" },
        timeoutMs: 1000,
        countTowardsLocalRateLimit: false,
        ...overrides
    };
}

function upload(id: string, overrides: Partial<RelayResponse> = {}): RelayResponse {
    return {
        id,
        status: 200,
        contentType: "application/json",
        body: "{}",
        finalUrl: `${BASE}/api/x`,
        ...overrides
    };
}

/** Meldet den Request als Miss (Ticket) und gibt seine id zurück. */
async function reportMiss(relay: RelayContext, request: UpstreamRequest) {
    await requestContext.run(context(relay), () =>
        assert.rejects(fetchUpstreamText(request), RelayRequiredError)
    );

    return relayFingerprint(request);
}

describe("device relay in fetchUpstreamText", () => {
    it("fetches normally without a relay context", async () => {
        const { bodyText } = await fetchUpstreamText(upstreamRequest("/api/ttr/team/players", { teamId: "1" }));

        assert.equal(bodyText, "{}");
        assert.equal(realFetchCalls, 1);
    });

    it("reports a miss instead of fetching", async () => {
        const relay = relayState();
        const request = upstreamRequest("/api/ttr/team/players", { teamId: "7" });

        await requestContext.run(context(relay), () =>
            assert.rejects(fetchUpstreamText(request), (error: unknown) => {
                assert.ok(error instanceof RelayRequiredError);
                assert.equal(error.skipRetryDelay, true);
                return true;
            })
        );

        assert.equal(realFetchCalls, 0);
        assert.equal(relay.misses.length, 1);

        const miss = relay.misses[0]!;

        assert.equal(miss.id, "GET /api/ttr/team/players?teamId=7");
        assert.equal(miss.url, `${BASE}/api/ttr/team/players?teamId=7`);
        assert.equal(miss.method, "GET");
        assert.deepEqual(miss.headers, { accept: "application/json" });
        assert.equal("cookie" in miss.headers, false);
    });

    it("does not repeat a miss and sorts the query in the fingerprint", async () => {
        const relay = relayState();
        const a = upstreamRequest("/p", { b: "2", a: "1" });
        const b = upstreamRequest("/p", { a: "1", b: "2" });

        await reportMiss(relay, a);
        await reportMiss(relay, b);

        assert.equal(relay.misses.length, 1);
        assert.equal(relayFingerprint(a), "GET /p?a=1&b=2");
        assert.equal(relayFingerprint(a), relayFingerprint(b));
    });

    it("serves an uploaded response without touching budget or the network", async () => {
        const relay = relayState();
        const request = upstreamRequest("/api/ttr/team/players", { teamId: "8" });
        const id = await reportMiss(relay, request);
        const usedBefore = getRateLimitStatus().used;

        const accepted = storeRelayResponses(UPLOADER, [
            upload(id, { body: '{"data":[]}', finalUrl: request.url.toString() })
        ]);

        assert.equal(accepted, 1);

        const served = relayState();
        const result = await requestContext.run(context(served), () => fetchUpstreamText(request));

        assert.equal(result.bodyText, '{"data":[]}');
        assert.equal(result.response.status, 200);
        assert.equal(result.response.headers.get("content-type"), "application/json");
        assert.equal(served.served, 1);
        assert.equal(served.misses.length, 0);
        assert.equal(realFetchCalls, 0);
        assert.equal(getRateLimitStatus().used, usedBefore);
    });

    it("keeps the remix error flag and handles bodyless statuses", async () => {
        const relay = relayState();
        const request = upstreamRequest("/page");
        const id = await reportMiss(relay, request);

        storeRelayResponses(UPLOADER, [
            upload(id, { status: 204, body: "", remixError: true, finalUrl: request.url.toString() })
        ]);

        const result = await requestContext.run(context(relayState()), () => fetchUpstreamText(request));

        assert.equal(result.response.status, 204);
        assert.equal(result.response.headers.get("x-remix-error"), "1");
        assert.equal(result.bodyText, "");
    });

    it("rejects uploads without a ticket", () => {
        assert.equal(storeRelayResponses(UPLOADER, [upload("GET /never?asked=1")]), 0);
        assert.equal(getRelayStatus().uploadsRejected, 1);
    });

    it("accepts a duplicate upload for a miss two requests reported, without overwriting", async () => {
        const request = upstreamRequest("/rankings/andro-rangliste", { clubnr: "08065" });
        // Zwei Requests desselben Geräts melden denselben Miss, beide laden die Antwort hoch.
        const id = await reportMiss(relayState(), request);
        await reportMiss(relayState(), request);

        const finalUrl = request.url.toString();

        assert.equal(storeRelayResponses(UPLOADER, [upload(id, { body: '{"first":1}', finalUrl })]), 1);
        assert.equal(storeRelayResponses(UPLOADER, [upload(id, { body: '{"second":2}', finalUrl })]), 1);
        assert.equal(getRelayStatus().uploadsDuplicate, 1);
        assert.equal(getRelayStatus().uploadsRejected, 0);

        const result = await requestContext.run(context(relayState()), () => fetchUpstreamText(request));

        assert.equal(result.bodyText, '{"first":1}', "the ticketed upload wins");
        assert.equal(realFetchCalls, 0);

        // Ein anderer Uploader darf die Lücke nicht nutzen.
        assert.equal(storeRelayResponses("ip:10.9.9.9", [upload(id, { finalUrl })]), 0);
    });

    it("rejects 429, verify redirects, other origins, huge bodies and impossible statuses", async () => {
        const request = upstreamRequest("/api/x");
        const relay = relayState();
        const id = await reportMiss(relay, request);

        const bad: Array<Partial<RelayResponse>> = [
            { status: 429 },
            { status: 99 },
            { status: 600 },
            { finalUrl: `${BASE}/verify?from=%2Fapi%2Fx` },
            { finalUrl: `${BASE}/verify/captcha` },
            { finalUrl: "https://evil.example/api/x" },
            { finalUrl: "not a url" },
            { body: "x".repeat(config.relay.maxBodyBytes + 1) }
        ];

        for (const overrides of bad) {
            // Jeder Versuch braucht ein frisches Ticket, ein abgelehnter Upload verbraucht keins.
            assert.equal(
                storeRelayResponses(UPLOADER, [upload(id, overrides)]),
                0,
                JSON.stringify(overrides).slice(0, 80)
            );
        }

        assert.equal(storeRelayResponses(UPLOADER, [upload(id)]), 1, "ticket survives rejected uploads");
    });

    it("lets inbox entries expire and does not serve other uploaders", async () => {
        const request = upstreamRequest("/api/x", { n: "1" });
        const id = await reportMiss(relayState(), request);
        const start = Date.now();

        storeRelayResponses(UPLOADER, [upload(id, { finalUrl: request.url.toString() })]);

        // Anderer Uploader bekommt die Antwort nicht.
        await requestContext.run(context(relayState("ip:10.9.9.9")), () =>
            assert.rejects(fetchUpstreamText(request), RelayRequiredError)
        );

        // Mehrere Runden dürfen dieselbe Antwort erneut lesen.
        await requestContext.run(context(relayState()), () => fetchUpstreamText(request));
        await requestContext.run(context(relayState()), () => fetchUpstreamText(request));

        mock.method(Date, "now", () => start + config.relay.inboxTtlMs + 1);

        await requestContext.run(context(relayState()), () =>
            assert.rejects(fetchUpstreamText(request), RelayRequiredError)
        );
    });

    it("never relays background work", async () => {
        const relay = relayState();

        await requestContext.run(context(relay), () =>
            runInBackground(() => fetchUpstreamText(upstreamRequest("/api/bg")))
        );

        assert.equal(realFetchCalls, 1);
        assert.equal(relay.misses.length, 0);
    });

    it("never relays requests with a cookie", async () => {
        const relay = relayState();

        await requestContext.run(context(relay), () =>
            fetchUpstreamText(upstreamRequest("/api/me", {}, { headers: { cookie: "session=1" } }))
        );

        assert.equal(realFetchCalls, 1);
        assert.equal(relay.misses.length, 0);
    });

    it("does not fall back to html on a relay miss", async () => {
        let fallbackCalls = 0;

        await assert.rejects(
            fetchWithFallback({
                name: "t",
                primary: async () => {
                    throw new RelayRequiredError();
                },
                fallback: async () => {
                    fallbackCalls += 1;
                    return 1;
                }
            }),
            RelayRequiredError
        );

        assert.equal(fallbackCalls, 0);
    });
});

describe("device relay through readByPolicy", () => {
    it("throws RelayRequiredError on a miss without an old value", async () => {
        const relay = relayState();

        await requestContext.run(context(relay), () =>
            assert.rejects(getTeamPlayerList("relay-a"), RelayRequiredError)
        );

        assert.equal(relay.misses.length, 1);
    });

    it("serves the old value while waiting, then the uploaded value without a retry pause", async () => {
        const key = cacheKeys.teamPlayers("relay-b");

        putCached(key, { data: [{ old: true }] }, 1);
        await new Promise((resolve) => setTimeout(resolve, 5));

        // (b) abgelaufener Eintrag: alter Stand, die Anfrage steht in misses.
        const waiting = relayState();
        const stale = await requestContext.run(context(waiting), () => getTeamPlayerList("relay-b"));

        assert.equal(stale.meta.source, "stale");
        assert.deepEqual(stale.value, { data: [{ old: true }] });
        assert.equal(waiting.misses.length, 1);

        // (c) Upload, dann sofort der neue Wert: kein retryAt wurde gesetzt.
        const miss = waiting.misses[0]!;

        assert.equal(
            storeRelayResponses(UPLOADER, [
                upload(miss.id, { body: '{"data":[{"fresh":true}]}', finalUrl: miss.url })
            ]),
            1
        );

        const next = relayState();
        const fresh = await requestContext.run(context(next), () => getTeamPlayerList("relay-b"));

        assert.deepEqual(fresh.value, { data: [{ fresh: true }] });
        assert.equal(fresh.meta.origin, "relay");
        assert.equal(fresh.meta.source, "upstream");
        assert.equal(next.misses.length, 0);
        assert.equal(next.served, 1);
        assert.equal(realFetchCalls, 0);
    });

    it("does not cache a value from a load that swallowed a missing response", async () => {
        const key = "relay-partial";
        const relay = relayState();

        await requestContext.run(context(relay), () =>
            assert.rejects(
                readByPolicy({
                    kind: "TEAM_INFOS",
                    key,
                    load: async () => {
                        const part = await fetchUpstreamText(upstreamRequest("/api/part")).catch(() => null);

                        return { part };
                    }
                }),
                RelayRequiredError
            )
        );

        assert.equal(relay.misses.length, 1);
        assert.equal(peekUsableCached(key), undefined);
    });

    it("ignores the relay when the request carries none", async () => {
        const result = await requestContext.run(context(), () => getTeamPlayerList("relay-plain"));

        assert.equal(result.meta.source, "upstream");
        assert.equal(realFetchCalls, 1);
    });
});

describe("relay helpers", () => {
    it("attaches relay requests to object payloads only", () => {
        const misses = [{ id: "a", method: "GET" as const, url: `${BASE}/a`, headers: {} }];

        assert.deepEqual(attachRelayRequests({ data: 1 }, misses), { data: 1, relay: { requests: misses } });
        assert.deepEqual(attachRelayRequests({ data: 1 }, []), { data: 1 });
        assert.equal(attachRelayRequests("text", misses), "text");
        assert.equal(attachRelayRequests(null, misses), null);

        const list = [1, 2];

        assert.equal(attachRelayRequests(list, misses), list);
    });

    it("stops uploads after the 30 minute limit", () => {
        assert.equal(allowRelayUpload("ip:limit", config.relay.uploadsPer30Min), true);
        assert.equal(allowRelayUpload("ip:limit", 1), false);
        assert.equal(allowRelayUpload("ip:other", 1), true);

        const later = Date.now() + 31 * 60 * 1000;

        mock.method(Date, "now", () => later);

        assert.equal(allowRelayUpload("ip:limit", 1), true);
    });
});

describe("club logos over the relay", () => {
    const refs = [1, 2, 3, 4, 5].map((n) => `TTBW:900000${n}`);

    function headUpload(miss: { id: string; url: string }, index: number) {
        return upload(miss.id, {
            body: JSON.stringify({
                headData: { club_nr: `900000${index + 1}`, logo_id: `logo-${index + 1}`, club_name: `Club ${index + 1}` }
            }),
            finalUrl: miss.url
        });
    }

    it("asks the phone for a capped number of heads, starts no server jobs, then serves them from the inbox", async () => {
        const first = relayState();
        const firstResult = await requestContext.run(context(first), () => getClubLogos(refs));

        assert.equal(first.misses.length, config.relay.logoHeadsPerCall);
        assert.deepEqual(firstResult.pending, refs);
        assert.deepEqual(firstResult.logos, {});

        await whenBackgroundIdle();

        assert.equal(realFetchCalls, 0);

        assert.equal(
            storeRelayResponses(
                UPLOADER,
                first.misses.map((miss, index) => headUpload(miss, index))
            ),
            config.relay.logoHeadsPerCall
        );

        // Neuer Kontext desselben Uploaders: dieselben ersten Vereine werden aus der Inbox bedient.
        const second = relayState();
        const secondResult = await requestContext.run(context(second), () => getClubLogos(refs));

        assert.equal(Object.keys(secondResult.logos).length, config.relay.logoHeadsPerCall);
        assert.ok(secondResult.logos["TTBW:9000001"]?.includes("logo-1"));
        assert.deepEqual(secondResult.pending, refs.slice(config.relay.logoHeadsPerCall));
        assert.equal(second.misses.length, 0);

        await whenBackgroundIdle();

        assert.equal(realFetchCalls, 0);
    });
});

describe("max age through readByPolicy", () => {
    const loadMissing = async () => {
        await fetchUpstreamText(upstreamRequest("/api/max-age"));

        return { data: { meetings: [] } } as never;
    };

    function withMaxAge(relay: RelayContext | undefined, maxAgeMs: number): RequestContext {
        return { ...context(relay), maxAgeMs };
    }

    async function putAged(key: string) {
        putCached(key, { data: { meetings: ["old"] } }, 60_000);
        await new Promise((resolve) => setTimeout(resolve, 10));
    }

    it("refetches an entry that is older than the max age and reports the miss", async () => {
        const key = "max-age-old";

        await putAged(key);

        const relay = relayState();
        const result = await requestContext.run(withMaxAge(relay, 5), () =>
            readByPolicy({ kind: "CLUB_SCHEDULE", key, load: loadMissing })
        );

        assert.equal(result.meta.source, "stale");
        assert.deepEqual(result.value, { data: { meetings: ["old"] } });
        assert.equal(relay.misses.length, 1);
        assert.equal(realFetchCalls, 0);
    });

    it("serves an entry that is younger than the max age from the cache", async () => {
        const key = "max-age-young";

        await putAged(key);

        const relay = relayState();
        const result = await requestContext.run(withMaxAge(relay, 120_000), () =>
            readByPolicy({ kind: "CLUB_SCHEDULE", key, load: loadMissing })
        );

        assert.equal(result.meta.source, "cache");
        assert.equal(relay.misses.length, 0);
    });

    it("ignores the max age without a relay, so the server IP never pays for it", async () => {
        const key = "max-age-no-relay";

        await putAged(key);

        const result = await requestContext.run(withMaxAge(undefined, 5), () =>
            readByPolicy({ kind: "CLUB_SCHEDULE", key, load: loadMissing })
        );

        assert.equal(result.meta.source, "cache");
        assert.equal(realFetchCalls, 0);
    });

    it("ignores the max age for kinds that are not refreshable", async () => {
        const key = "max-age-not-refreshable";

        await putAged(key);

        const relay = relayState();
        const result = await requestContext.run(withMaxAge(relay, 5), () =>
            readByPolicy({ kind: "CLUB_HEAD", key, load: loadMissing })
        );

        assert.equal(result.meta.source, "cache");
        assert.equal(relay.misses.length, 0);
    });
});
