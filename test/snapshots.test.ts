import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";

let dir: string;
let sessions: typeof import("../src/myttSessionStore.js");
let snapshots: typeof import("../src/services/snapshots.js");
let errors: typeof import("../src/snapshotErrors.js");
let grantStore: typeof import("../src/store/grantStore.js");
let snapshotStore: typeof import("../src/store/snapshotStore.js");

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-10-30T12:00:00Z");

before(async () => {
    dir = await mkdtemp(join(tmpdir(), "tttracker-snapshots-"));

    process.env.TTTRACKER_SESSION_STORE_FILE = join(dir, "sessions.json");
    process.env.TTTRACKER_SESSION_SECRET = "x".repeat(40);

    // Alte Datei mit einer Freigabe: sie muss in die Ablage übernommen werden.
    await writeFile(
        process.env.TTTRACKER_SESSION_STORE_FILE,
        JSON.stringify({
            sessions: {},
            grants: {
                legacy1: {
                    id: "legacy1",
                    ownerUserId: "legacy-owner",
                    granteeUserId: "legacy-friend",
                    scopes: ["ttr:read"],
                    expiresAt: null,
                    createdAt: "2026-10-01T10:00:00.000Z",
                    revokedAt: null
                }
            }
        })
    );

    sessions = await import("../src/myttSessionStore.js");
    snapshots = await import("../src/services/snapshots.js");
    errors = await import("../src/snapshotErrors.js");
    grantStore = await import("../src/store/grantStore.js");
    snapshotStore = await import("../src/store/snapshotStore.js");
});

after(async () => {
    await rm(dir, { recursive: true, force: true });
});

let counter = 0;
let owner: string;
let friend: string;

beforeEach(() => {
    counter += 1;
    owner = `owner-${counter}`;
    friend = `friend-${counter}`;
});

function ttrPart(fetchedAt = new Date(NOW - 60_000).toISOString(), ttr: number | null = 1500) {
    return { fetchedAt, data: { ttr, error: null } };
}

function historyPart(overrides: Record<string, unknown> = {}, fetchedAt = new Date(NOW - 60_000).toISOString()) {
    return {
        fetchedAt,
        data: {
            ttr: 1500,
            vq_ttr: 1490,
            ttr_date: "2026-10-01",
            club_name: "TTV Test",
            person_id: "NU4711",
            person_name: "Max Muster",
            event: [{ event_id: 1, event_name: "Spiel", ttr_before: 1480, ttr_after: 1500, match: [] }],
            error: null,
            ...overrides
        }
    };
}

function body(extra: Record<string, unknown> = {}) {
    return snapshots.SnapshotBodySchema.parse({
        nuid: "nu4711",
        ttr: ttrPart(),
        ttrHistory: historyPart(),
        ...extra
    });
}

async function share(scopes: ("ttr:read" | "ttr_history:read")[] = ["ttr:read", "ttr_history:read"], expiresAt?: string) {
    return sessions.createMyttGrant({ ownerUserId: owner, granteeUserId: friend, scopes, expiresAt });
}

describe("grants in the store", () => {
    it("takes over grants from the old session file once", async () => {
        const status = await sessions.getMyttStatusForUser("legacy-friend");

        assert.equal(status.grantsReceived.length, 1);
        assert.equal(status.grantsReceived[0]!.id, "legacy1");
        assert.equal(grantStore.getGrant("legacy1")?.ownerUserId, "legacy-owner");
    });
});

describe("snapshot upload", () => {
    it("refuses an upload while nothing is shared", async () => {
        assert.throws(() => snapshots.uploadSnapshot(owner, body(), NOW), errors.SnapshotNotSharingError);
        assert.equal(snapshotStore.getSnapshotByUser(owner), null);
    });

    it("stores an upload once a grant exists", async () => {
        await share();
        snapshots.uploadSnapshot(owner, body(), NOW);

        const stored = snapshotStore.getSnapshotByUser(owner);

        assert.equal(stored?.nuid, "NU4711");
        assert.equal(stored?.ttrFetchedAt, NOW - 60_000);
    });

    it("rejects data that does not match the schemas", () => {
        assert.throws(() =>
            snapshots.SnapshotBodySchema.parse({ nuid: "nu4711", ttr: { fetchedAt: "gestern", data: {} } })
        );
        assert.throws(() => snapshots.SnapshotBodySchema.parse({ nuid: "4711", ttr: ttrPart() }));
        assert.throws(() => snapshots.SnapshotBodySchema.parse({ nuid: "nu4711" }));
        assert.throws(() =>
            snapshots.SnapshotBodySchema.parse({
                nuid: "nu4711",
                ttrHistory: { fetchedAt: new Date(NOW).toISOString(), data: { event: "kaputt" } }
            })
        );
    });

    it("rejects snapshots with an error payload, a future or very old date", async () => {
        await share();

        assert.throws(
            () => snapshots.uploadSnapshot(owner, body({ ttr: { fetchedAt: new Date(NOW).toISOString(), data: { ttr: null, error: "login" } } }), NOW),
            errors.SnapshotInvalidError
        );
        assert.throws(
            () => snapshots.uploadSnapshot(owner, body({ ttr: ttrPart(new Date(NOW + HOUR).toISOString()) }), NOW),
            errors.SnapshotInvalidError
        );
        assert.throws(
            () => snapshots.uploadSnapshot(owner, body({ ttr: ttrPart(new Date(NOW - 60 * 24 * HOUR).toISOString()) }), NOW),
            errors.SnapshotInvalidError
        );
    });

    it("rejects a history of another player", async () => {
        await share();

        assert.throws(
            () => snapshots.uploadSnapshot(owner, body({ ttrHistory: historyPart({ person_id: "NU999" }) }), NOW),
            errors.SnapshotInvalidError
        );
    });

    it("rejects oversized uploads", async () => {
        await share();

        const events = Array.from({ length: 1500 }, (_, index) => ({
            event_id: index,
            event_name: "x".repeat(500),
            match: []
        }));

        assert.throws(
            () => snapshots.uploadSnapshot(owner, body({ ttrHistory: historyPart({ event: events }) }), NOW),
            errors.SnapshotTooLargeError
        );
    });

    it("allows one upload per hour", async () => {
        // Die Freigabe entsteht mit der echten Uhr, also rechnet dieser Test auch damit.
        await share();

        // Nach der Freigabe, sonst zählt sie als neu.
        const start = Date.now() + 5;

        snapshots.uploadSnapshot(owner, body({ ttr: ttrPart(new Date(start).toISOString()) }), start);

        assert.throws(
            () => snapshots.uploadSnapshot(owner, body({ ttr: ttrPart(new Date(start).toISOString()) }), start + 30 * 60_000),
            (error: unknown) =>
                error instanceof errors.SnapshotThrottledError &&
                error.retryAfterMs === 30 * 60_000
        );

        assert.doesNotThrow(() =>
            snapshots.uploadSnapshot(owner, body({ ttr: ttrPart(new Date(start).toISOString()) }), start + HOUR + 1)
        );
    });

    it("lifts the limit after a new grant so the receiver does not wait", async () => {
        await share();
        snapshots.uploadSnapshot(owner, body(), Date.now() - 10 * 60_000);

        await sessions.createMyttGrant({
            ownerUserId: owner,
            granteeUserId: `${friend}-2`,
            scopes: ["ttr:read"]
        });

        // Die neue Freigabe liegt nach dem letzten Upload.
        assert.doesNotThrow(() => snapshots.uploadSnapshot(owner, body(), Date.now() + 1000));
    });

    it("binds the player and asks before another one replaces it", async () => {
        await share();
        snapshots.uploadSnapshot(owner, body(), NOW);

        const other = body({
            nuid: "NU999",
            ttrHistory: historyPart({ person_id: "NU999" })
        });

        assert.throws(
            () => snapshots.uploadSnapshot(owner, other, NOW + 2 * HOUR),
            (error: unknown) =>
                error instanceof errors.SnapshotPlayerMismatchError && error.registeredNuid === "NU4711"
        );

        snapshots.uploadSnapshot(owner, { ...other, replacePlayer: true }, NOW + 2 * HOUR);

        assert.equal(snapshotStore.getSnapshotByUser(owner)?.nuid, "NU999");
    });

    it("keeps the other part when only one is uploaded", async () => {
        await share();
        snapshots.uploadSnapshot(owner, body(), NOW);
        snapshots.uploadSnapshot(
            owner,
            snapshots.SnapshotBodySchema.parse({ nuid: "NU4711", ttr: ttrPart(new Date(NOW + HOUR).toISOString(), 1510) }),
            NOW + 2 * HOUR
        );

        const stored = snapshotStore.getSnapshotByUser(owner);

        assert.equal((stored?.ttr as { ttr: number }).ttr, 1510);
        assert.ok(stored?.history, "history stays");
    });
});

describe("shared player", () => {
    it("is not visible without a grant", async () => {
        await share();
        snapshots.uploadSnapshot(owner, body(), NOW);

        await assert.rejects(snapshots.getSharedPlayer("stranger", "NU4711", NOW), errors.SharedPlayerNotFoundError);
    });

    it("gives a receiver the snapshot with owner and age", async () => {
        const created = await share();
        snapshots.uploadSnapshot(owner, body(), NOW);

        const { value, meta } = await snapshots.getSharedPlayer(friend, "nu4711", NOW);

        assert.equal(value.nuid, "NU4711");
        assert.equal(value.ttr?.ttr, 1500);
        assert.equal(value.history?.events.length, 1);
        assert.equal(value.history?.personName, "Max Muster");
        assert.equal(value.ttr?.fetchedAt, new Date(NOW - 60_000).toISOString());
        assert.equal(meta.source, "snapshot");
        assert.equal(meta.fetchedAt, new Date(NOW - 60_000).toISOString());
        assert.deepEqual(value.scopes.sort(), ["ttr:read", "ttr_history:read"]);
        assert.equal(created.ownerUserId, owner);
    });

    it("only gives what the scope allows", async () => {
        await share(["ttr:read"]);
        snapshots.uploadSnapshot(owner, body(), NOW);

        const { value } = await snapshots.getSharedPlayer(friend, "NU4711", NOW);

        assert.equal(value.ttr?.ttr, 1500);
        assert.equal(value.history, undefined);
    });

    it("derives the current TTR from the history when only the history was uploaded", async () => {
        await share(["ttr:read"]);
        snapshots.uploadSnapshot(
            owner,
            snapshots.SnapshotBodySchema.parse({ nuid: "NU4711", ttrHistory: historyPart() }),
            NOW
        );

        const { value } = await snapshots.getSharedPlayer(friend, "NU4711", NOW);

        assert.equal(value.ttr?.ttr, 1500);
        assert.equal(value.history, undefined);
    });

    it("ends with the grant: revoked, expired or removed", async () => {
        const grant = await share();
        snapshots.uploadSnapshot(owner, body(), NOW);

        await sessions.revokeMyttGrant({ ownerUserId: owner, grantId: grant.id });

        await assert.rejects(snapshots.getSharedPlayer(friend, "NU4711", NOW), errors.SharedPlayerNotFoundError);
        assert.equal(snapshotStore.getSnapshotByUser(owner), null, "snapshot leaves the server");
    });

    it("stops serving once the grant has expired", async () => {
        await share(["ttr:read", "ttr_history:read"], new Date(NOW + HOUR).toISOString());
        snapshots.uploadSnapshot(owner, body(), NOW);

        assert.ok(await snapshots.getSharedPlayer(friend, "NU4711", NOW));

        await assert.rejects(
            snapshots.getSharedPlayer(friend, "NU4711", NOW + 2 * HOUR),
            errors.SharedPlayerNotFoundError
        );
    });

    it("drops the snapshot with the next status once every grant has expired", async () => {
        const created = await share();
        snapshots.uploadSnapshot(owner, body(), NOW);

        // Ablauf nachträglich in die Vergangenheit setzen (die Ablage kennt kein Update, also neu anlegen).
        const db = (await import("../src/store/db.js")).getStoreDb()!;
        db.prepare("UPDATE mytt_grants SET expires_at = ? WHERE id = ?").run(
            new Date(Date.now() - 1000).toISOString(),
            created.id
        );

        const status = await sessions.getMyttStatusForUser(owner);

        assert.equal(status.hasActiveGrants, false);
        assert.equal(snapshotStore.getSnapshotByUser(owner), null);
    });

    it("does not hand the snapshot to its own owner", async () => {
        await share();
        snapshots.uploadSnapshot(owner, body(), NOW);

        await assert.rejects(snapshots.getSharedPlayer(owner, "NU4711", NOW), errors.SharedPlayerNotFoundError);
    });

    it("lets the owner stop sharing data without revoking grants", async () => {
        await share();
        snapshots.uploadSnapshot(owner, body(), NOW);
        snapshots.removeOwnSnapshot(owner);

        await assert.rejects(snapshots.getSharedPlayer(friend, "NU4711", NOW), errors.SharedPlayerNotFoundError);
        assert.equal((await sessions.getMyttStatusForUser(owner)).hasActiveGrants, true);
    });
});
