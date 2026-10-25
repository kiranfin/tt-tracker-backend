import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCanary, diffPaths, type CanaryDeps } from "../src/canary/runCanary.js";
import type { CanaryProbe } from "../src/canary/probes.js";
import { MailNotConfiguredError } from "../src/mailer.js";

const ROUTE_ID = "routes/test";

function pageWith(data: unknown) {
    return `<script>window.__remixContext = ${JSON.stringify({
        state: { loaderData: { [ROUTE_ID]: data } }
    })};</script>`;
}

function probe(overrides?: Partial<CanaryProbe>): CanaryProbe {
    return {
        name: "test_probe",
        path: "/test",
        searchParams: new URLSearchParams({ _data: ROUTE_ID }),
        routeId: ROUTE_ID,
        check: () => undefined,
        ...overrides
    };
}

function setup(params: {
    api: () => Promise<unknown>;
    html: () => Promise<string>;
    probes?: CanaryProbe[];
    sendAlert?: CanaryDeps["sendAlert"];
}) {
    const mails: string[] = [];
    const snapshots: string[] = [];

    const canary = createCanary({
        probes: params.probes ?? [probe()],
        fetchApi: params.api,
        fetchHtml: params.html,
        saveSnapshot: async (p) => {
            snapshots.push(p.name);
            return `data/canary/${p.name}.html`;
        },
        sendAlert:
            params.sendAlert ??
            (async (subject) => {
                mails.push(subject);
            }),
        now: () => new Date("2026-01-01T00:00:00Z")
    });

    return { canary, mails, snapshots };
}

describe("diffPaths", () => {
    it("names the differing paths", () => {
        assert.deepEqual(diffPaths({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] }), []);
        assert.deepEqual(diffPaths({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 } }), ["$.b.c"]);
        assert.deepEqual(diffPaths({ a: 1 }, { a: 1, x: 2 }), ["$.x (only in page)"]);
        assert.deepEqual(diffPaths([1], [1, 2]), ["$ (length 1 vs 2)"]);
    });
});

describe("canary", () => {
    it("reports ok when API and page agree, ignoring the volatile download token", async () => {
        const { canary, mails } = setup({
            api: async () => ({ pdf: "https://x/d?meeting=1&historicalDataToken=AAA%3D" }),
            html: async () => pageWith({ pdf: "https://x/d?meeting=1&historicalDataToken=BBB%3D" })
        });

        const report = await canary.run();

        assert.equal(report.status, "ok");
        assert.equal(report.probes[0].status, "ok");
        assert.equal(mails.length, 0);
    });

    it("reports diverged when API and page differ", async () => {
        const { canary, snapshots } = setup({
            api: async () => ({ rows: [1, 2, 3] }),
            html: async () => pageWith({ rows: [1, 2, 4] })
        });

        const report = await canary.run();

        assert.equal(report.status, "problem");
        assert.equal(report.probes[0].status, "diverged");
        assert.match(report.probes[0].reasons[0], /\$\.rows\[2\]/);
        assert.deepEqual(snapshots, ["test_probe"]);
    });

    it("reports failed when a source errors or the check rejects", async () => {
        const apiDown = setup({
            api: async () => {
                throw new Error("HTTP 500");
            },
            html: async () => pageWith({})
        });
        const badData = setup({
            api: async () => ({}),
            html: async () => pageWith({}),
            probes: [
                probe({
                    check: () => {
                        throw new Error("table has no rows");
                    }
                })
            ]
        });
        const noContext = setup({
            api: async () => ({}),
            html: async () => "<html>no data</html>"
        });

        for (const { canary } of [apiDown, badData, noContext]) {
            const report = await canary.run();

            assert.equal(report.probes[0].status, "failed");
        }
    });

    it("sends a mail only when the state changes from ok to problem", async () => {
        let broken = false;
        const { canary, mails } = setup({
            api: async () => ({ a: 1 }),
            html: async () => pageWith({ a: broken ? 2 : 1 })
        });

        assert.equal((await canary.run()).alert, "not_needed");

        broken = true;
        assert.equal((await canary.run()).alert, "sent");
        assert.equal((await canary.run()).alert, "not_needed");
        assert.equal(mails.length, 1);

        broken = false;
        assert.equal((await canary.run()).status, "ok");

        broken = true;
        assert.equal((await canary.run()).alert, "sent");
        assert.equal(mails.length, 2);
    });

    it("does not fail when mail is not configured, and keeps the last report", async () => {
        const { canary } = setup({
            api: async () => ({ a: 1 }),
            html: async () => pageWith({ a: 2 }),
            sendAlert: async () => {
                throw new MailNotConfiguredError();
            }
        });

        assert.equal(canary.lastReport(), null);

        const report = await canary.run();

        assert.equal(report.alert, "not_configured");
        assert.equal(canary.lastReport(), report);
    });

    it("retries the mail on the next run when sending failed", async () => {
        let attempts = 0;
        const { canary } = setup({
            api: async () => ({ a: 1 }),
            html: async () => pageWith({ a: 2 }),
            sendAlert: async () => {
                attempts += 1;

                if (attempts === 1) {
                    throw new Error("smtp down");
                }
            }
        });

        assert.equal((await canary.run()).alert, "failed");
        assert.equal((await canary.run()).alert, "sent");
        assert.equal(attempts, 2);
    });

    it("runs only once at a time", async () => {
        let apiCalls = 0;
        const { canary } = setup({
            api: async () => {
                apiCalls += 1;
                await new Promise((resolve) => setTimeout(resolve, 10));
                return { a: 1 };
            },
            html: async () => pageWith({ a: 1 })
        });

        await Promise.all([canary.run(), canary.run()]);

        assert.equal(apiCalls, 1);
    });
});
