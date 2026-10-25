import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { UpstreamError } from "../src/upstream/errors.js";
import { fetchUpstreamText } from "../src/upstream/fetch.js";

let server: Server;
let baseUrl: string;

before(async () => {
    server = createServer((req, res) => {
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
