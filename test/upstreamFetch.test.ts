import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { config } from "../src/config.js";
import {
    LocalRateLimitError,
    UpstreamChallengeError,
    UpstreamError
} from "../src/upstream/errors.js";
import { fetchUpstreamText } from "../src/upstream/fetch.js";
import { getChallengeStatus, resetBreakersForTests } from "../src/upstream/rateLimiter.js";

let server: Server;
let baseUrl: string;
let hits: string[] = [];

before(async () => {
    server = createServer((req, res) => {
        hits.push(req.url ?? "");

        if (req.url === "/to-verify") {
            res.writeHead(302, { location: "/verify?from=%2Fapi%2Fttr%2Fhistory%2FNU1" });
            res.end();
            return;
        }

        if (req.url === "/remix-verify") {
            res.writeHead(204, { "x-remix-redirect": "/verify?from=%2Fclick-tt" });
            res.end();
            return;
        }

        if (req.url === "/verify") {
            res.writeHead(429, { "content-type": "text/html" });
            res.end("verify");
            return;
        }

        if (req.url === "/redirect") {
            res.writeHead(302, { location: "/final" });
            res.end();
            return;
        }

        if (req.url === "/final") {
            res.writeHead(200, { "content-type": "text/html" });
            res.end("final");
            return;
        }

        if (req.url === "/loop") {
            res.writeHead(302, { location: "/loop" });
            res.end();
            return;
        }

        if (req.url === "/other-origin") {
            res.writeHead(302, { location: baseUrl.replace("127.0.0.1", "localhost") + "/final" });
            res.end();
            return;
        }

        if (req.url === "/hang") {
            // Header gehen raus, der Body kommt nie.
            res.writeHead(200, { "content-type": "text/html" });
            res.write("<html>");
            return;
        }

        if (req.url === "/big") {
            res.writeHead(200, { "content-type": "text/html" });
            res.end("x".repeat(5000));
            return;
        }

        res.writeHead(200, { "content-type": "text/html" });
        res.end("ok");
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
});

function request(path: string, maxBytes?: number) {
    return fetchUpstreamText({
        method: "GET",
        url: new URL(`${baseUrl}${path}`),
        path,
        headers: {},
        timeoutMs: 300,
        maxBytes,
        countTowardsLocalRateLimit: false
    });
}

describe("fetchUpstreamText", () => {
    it("returns the body", async () => {
        const { bodyText } = await request("/ok", 1000);

        assert.equal(bodyText, "ok");
    });

    it("turns a body timeout into an UpstreamError (without size limit)", async () => {
        await assert.rejects(request("/hang"), (error: unknown) => {
            assert.ok(error instanceof UpstreamError);
            assert.match(error.message, /timed out/);
            return true;
        });
    });

    it("turns a body timeout into an UpstreamError (with size limit)", async () => {
        await assert.rejects(request("/hang", 1000), (error: unknown) => {
            assert.ok(error instanceof UpstreamError);
            assert.match(error.message, /timed out/);
            return true;
        });
    });

    it("keeps the size limit error", async () => {
        await assert.rejects(request("/big", 100), (error: unknown) => {
            assert.ok(error instanceof UpstreamError);
            assert.match(error.message, /too large/);
            return true;
        });
    });
});

describe("fetchUpstreamText redirects", () => {
    it("follows a same origin redirect and reports the final url", async () => {
        const { bodyText, finalUrl } = await request("/redirect", 1000);

        assert.equal(bodyText, "final");
        assert.equal(finalUrl, `${baseUrl}/final`);
    });

    it("stops after three redirects", async () => {
        await assert.rejects(request("/loop"), (error: unknown) => {
            assert.ok(error instanceof UpstreamError);
            assert.match(error.message, /redirected more than/);
            return true;
        });
    });

    it("refuses a redirect to another origin", async () => {
        await assert.rejects(request("/other-origin"), (error: unknown) => {
            assert.ok(error instanceof UpstreamError);
            assert.match(error.message, /another origin/);
            return true;
        });
    });
});

describe("fetchUpstreamText challenge", () => {
    it("turns a 302 to /verify into an UpstreamChallengeError without following it", async () => {
        resetBreakersForTests();
        hits = [];

        await assert.rejects(request("/to-verify"), (error: unknown) => {
            assert.ok(error instanceof UpstreamChallengeError);
            assert.match(error.location ?? "", /^\/verify/);
            return true;
        });

        assert.deepEqual(hits, ["/to-verify"], "the verify page must not be requested");
        assert.equal(getChallengeStatus().active, true);

        resetBreakersForTests();
    });

    it("turns a 204 with x-remix-redirect to /verify into an UpstreamChallengeError", async () => {
        resetBreakersForTests();

        await assert.rejects(request("/remix-verify"), UpstreamChallengeError);

        resetBreakersForTests();
    });

    it("sends nothing while the challenge pause runs", async () => {
        resetBreakersForTests();

        await assert.rejects(request("/to-verify"), UpstreamChallengeError);

        hits = [];

        await assert.rejects(request("/ok"), (error: unknown) => {
            assert.ok(error instanceof LocalRateLimitError);
            assert.equal(error.reason, "upstream_challenge");
            return true;
        });

        assert.deepEqual(hits, []);

        resetBreakersForTests();
    });

    it("simulates a challenge with MYTT_FORCE_CHALLENGE without a request", async () => {
        resetBreakersForTests();
        hits = [];

        const upstream = config.upstream as { forceChallenge: boolean };
        const before = upstream.forceChallenge;
        upstream.forceChallenge = true;

        try {
            await assert.rejects(request("/ok"), UpstreamChallengeError);
        } finally {
            upstream.forceChallenge = before;
        }

        assert.deepEqual(hits, []);

        resetBreakersForTests();
    });
});

