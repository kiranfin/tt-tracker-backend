import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

let dir: string;
let store: typeof import("../src/myttSessionStore.js");

before(async () => {
    dir = await mkdtemp(join(tmpdir(), "tttracker-sessions-"));

    process.env.TTTRACKER_SESSION_STORE_FILE = join(dir, "sessions.json");
    process.env.TTTRACKER_SESSION_SECRET = "x".repeat(40);

    store = await import("../src/myttSessionStore.js");
});

after(async () => {
    await rm(dir, { recursive: true, force: true });
});

const SCOPES: ("ttr:read" | "ttr_history:read")[] = ["ttr:read", "ttr_history:read"];

async function hasServerSession(userId: string) {
    const status = await store.getMyttStatusForUser(userId);

    return status.ownSession !== null;
}

describe("myttSessionStore sharing", () => {
    it("requires an uploaded session before a grant can be created", async () => {
        await assert.rejects(
            store.createMyttGrant({
                ownerUserId: "owner-a",
                granteeUserId: "friend-a",
                scopes: SCOPES
            }),
            store.MyttSessionUploadRequiredError
        );
    });

    it("reports active grants in the status", async () => {
        await store.setMyttCookieForUser({ ownerUserId: "owner-b", cookie: "a=1; b=2" });

        assert.equal((await store.getMyttStatusForUser("owner-b")).hasActiveGrants, false);

        await store.createMyttGrant({
            ownerUserId: "owner-b",
            granteeUserId: "friend-b",
            scopes: SCOPES
        });

        assert.equal((await store.getMyttStatusForUser("owner-b")).hasActiveGrants, true);
    });

    it("deletes the server session when the last grant is revoked", async () => {
        await store.setMyttCookieForUser({ ownerUserId: "owner-c", cookie: "a=1" });

        const first = await store.createMyttGrant({
            ownerUserId: "owner-c",
            granteeUserId: "friend-c1",
            scopes: SCOPES
        });
        const second = await store.createMyttGrant({
            ownerUserId: "owner-c",
            granteeUserId: "friend-c2",
            scopes: SCOPES
        });

        await store.revokeMyttGrant({ ownerUserId: "owner-c", grantId: first.id });
        assert.equal(await hasServerSession("owner-c"), true);

        await store.revokeMyttGrant({ ownerUserId: "owner-c", grantId: second.id });
        assert.equal(await hasServerSession("owner-c"), false);
    });

    it("deletes the server session once the last grant has expired", async () => {
        await store.setMyttCookieForUser({ ownerUserId: "owner-d", cookie: "a=1" });

        await store.createMyttGrant({
            ownerUserId: "owner-d",
            granteeUserId: "friend-d",
            scopes: SCOPES,
            expiresAt: new Date(Date.now() - 1000).toISOString()
        });

        assert.equal(await hasServerSession("owner-d"), false);
    });

    it("keeps a session that was never shared", async () => {
        await store.setMyttCookieForUser({ ownerUserId: "owner-e", cookie: "a=1" });

        assert.equal(await hasServerSession("owner-e"), true);
    });

    it("lets the grantee use the shared session until the grant ends", async () => {
        await store.setMyttCookieForUser({ ownerUserId: "owner-f", cookie: "a=1" });

        const grant = await store.createMyttGrant({
            ownerUserId: "owner-f",
            granteeUserId: "friend-f",
            scopes: SCOPES
        });

        const resolved = await store.resolveMyttSessionForRequest({
            requesterUserId: "friend-f",
            requiredScope: "ttr:read"
        });

        assert.equal(resolved.mode, "delegated");

        await store.revokeMyttGrant({ ownerUserId: "owner-f", grantId: grant.id });

        await assert.rejects(
            store.resolveMyttSessionForRequest({
                requesterUserId: "friend-f",
                requiredScope: "ttr:read"
            }),
            store.MyttAccountRequiredError
        );
    });
});
