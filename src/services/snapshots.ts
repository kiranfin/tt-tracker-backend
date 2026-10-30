import { z } from "zod";
import { findAppUserById } from "../authStore.js";
import { PlayerTtrHistoryResponseSchema, PlayerTtrResponseSchema } from "../schemas.js";
import {
    SharedPlayerNotFoundError,
    SnapshotInvalidError,
    SnapshotNotSharingError,
    SnapshotPlayerMismatchError,
    SnapshotThrottledError,
    SnapshotTooLargeError
} from "../snapshotErrors.js";
import {
    isGrantActive,
    isGrantLive,
    listGrantsByGrantee,
    listGrantsByOwner,
    type MyttScope
} from "../store/grantStore.js";
import {
    deleteSnapshot,
    getSnapshotByUser,
    listSnapshotsByNuid,
    saveSnapshot
} from "../store/snapshotStore.js";
import { normalizeNuid } from "../utils/nuid.js";
import type { ResponseMeta } from "./read.js";
import { toTtrData, toTtrHistoryData } from "./ttrShape.js";

// Persönliche TTR Daten holt nur das Handy des Besitzers von myTischtennis. Der Server legt sie als
// Snapshot ab, solange der Besitzer teilt, und liefert sie nur an Empfänger mit passender Freigabe.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Höchstens einmal pro Stunde und Nutzer. */
export const SNAPSHOT_MIN_INTERVAL_MS = HOUR_MS;

/** Größe des gesamten Hochladens in Zeichen. Ein Verlauf mit allen Spielen liegt weit darunter. */
export const SNAPSHOT_MAX_CHARS = 600_000;

const MAX_HISTORY_EVENTS = 2000;
const MAX_AGE_MS = 30 * DAY_MS;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const NuidSchema = z
    .string()
    .trim()
    .regex(/^NU\d{1,12}$/i)
    .transform((value) => value.toUpperCase());

const PartSchema = <T extends z.ZodTypeAny>(data: T) =>
    z.object({
        // Wann das Handy die Daten bei myTischtennis geholt hat.
        fetchedAt: z.string().datetime(),
        data
    });

export const SnapshotBodySchema = z
    .object({
        nuid: NuidSchema,
        ttr: PartSchema(PlayerTtrResponseSchema).optional(),
        ttrHistory: PartSchema(PlayerTtrHistoryResponseSchema).optional(),
        // Die hinterlegte Spieler ID ersetzen (der Nutzer hat im Profil einen anderen Spieler gewählt).
        replacePlayer: z.boolean().optional()
    })
    .refine((body) => body.ttr || body.ttrHistory, {
        message: "ttr oder ttrHistory ist erforderlich."
    });

export type SnapshotBody = z.infer<typeof SnapshotBodySchema>;

function hasError(value: { error?: unknown }) {
    return value.error !== null && value.error !== undefined;
}

function toTimestamp(fetchedAt: string, now: number) {
    const timestamp = Date.parse(fetchedAt);

    if (timestamp > now + CLOCK_SKEW_MS) {
        throw new SnapshotInvalidError("fetchedAt liegt in der Zukunft");
    }

    if (timestamp < now - MAX_AGE_MS) {
        throw new SnapshotInvalidError("fetchedAt ist zu alt");
    }

    return timestamp;
}

function playerIdOf(nuid: string) {
    return nuid.replace(/^NU/i, "");
}

/**
 * Speichert den Snapshot des Besitzers. Geprüft werden Schema, Größe, Alter, dass es überhaupt Empfänger
 * gibt, die Spieler ID und das Limit von einem Upload pro Stunde (eine neue Freigabe hebt es auf, damit
 * der Empfänger nicht eine Stunde warten muss).
 */
export function uploadSnapshot(userId: string, body: SnapshotBody, now = Date.now()) {
    if (JSON.stringify(body).length > SNAPSHOT_MAX_CHARS) {
        throw new SnapshotTooLargeError();
    }

    const grants = listGrantsByOwner(userId);

    if (!grants.some((grant) => isGrantLive(grant, now))) {
        throw new SnapshotNotSharingError();
    }

    if (body.ttr && hasError(body.ttr.data)) {
        throw new SnapshotInvalidError("ttr enthält einen Fehler");
    }

    if (body.ttrHistory) {
        const history = body.ttrHistory.data;

        if (hasError(history)) {
            throw new SnapshotInvalidError("ttrHistory enthält einen Fehler");
        }

        if (history.event.length > MAX_HISTORY_EVENTS) {
            throw new SnapshotTooLargeError();
        }

        // Gehört der Verlauf erkennbar zu einem anderen Spieler, wird er nicht angenommen.
        if (history.person_id && playerIdOf(normalizeNuid(history.person_id)) !== playerIdOf(body.nuid)) {
            throw new SnapshotInvalidError("person_id passt nicht zur Spieler ID");
        }
    }

    const ttrAt = body.ttr ? toTimestamp(body.ttr.fetchedAt, now) : null;
    const historyAt = body.ttrHistory ? toTimestamp(body.ttrHistory.fetchedAt, now) : null;

    const existing = getSnapshotByUser(userId);

    if (existing && existing.nuid !== body.nuid && !body.replacePlayer) {
        throw new SnapshotPlayerMismatchError(existing.nuid);
    }

    if (existing) {
        const sinceUpload = now - existing.lastUploadAt;
        const newGrant = grants.some((grant) => Date.parse(grant.createdAt) > existing.lastUploadAt);

        if (sinceUpload < SNAPSHOT_MIN_INTERVAL_MS && !newGrant) {
            throw new SnapshotThrottledError(SNAPSHOT_MIN_INTERVAL_MS - sinceUpload);
        }
    }

    saveSnapshot({
        userId,
        nuid: body.nuid,
        ttr: body.ttr && ttrAt !== null ? { value: body.ttr.data, fetchedAt: ttrAt } : undefined,
        history:
            body.ttrHistory && historyAt !== null
                ? { value: body.ttrHistory.data, fetchedAt: historyAt }
                : undefined,
        now
    });
}

/** Der Besitzer beendet das Teilen der Daten, ohne Freigaben zu widerrufen. */
export function removeOwnSnapshot(userId: string) {
    deleteSnapshot(userId);
}

export type SharedPlayer = {
    nuid: string;
    owner: { username: string | null };
    scopes: MyttScope[];
    ttr?: ReturnType<typeof toTtrData> & { fetchedAt: string };
    history?: ReturnType<typeof toTtrHistoryData> & { fetchedAt: string };
};

/**
 * Snapshot eines Spielers für einen Empfänger. Geliefert wird nur, was die lebende Freigabe des Besitzers
 * erlaubt: ttr:read für den aktuellen TTR, ttr_history:read für den Verlauf. Sonst SharedPlayerNotFoundError,
 * ohne zu verraten, ob es den Spieler gibt.
 */
export async function getSharedPlayer(
    requesterUserId: string,
    rawNuid: string,
    now = Date.now()
): Promise<{ value: SharedPlayer; meta: ResponseMeta }> {
    const nuid = normalizeNuid(rawNuid);
    const received = listGrantsByGrantee(requesterUserId).filter((grant) => isGrantLive(grant, now));

    for (const snapshot of listSnapshotsByNuid(nuid)) {
        if (snapshot.userId === requesterUserId) {
            continue;
        }

        const grants = received.filter((grant) => grant.ownerUserId === snapshot.userId);
        const scopes = [...new Set(grants.flatMap((grant) => grant.scopes))];
        const mayReadTtr = grants.some((grant) => isGrantActive(grant, "ttr:read", now));
        const mayReadHistory = grants.some((grant) => isGrantActive(grant, "ttr_history:read", now));

        if (!mayReadTtr && !mayReadHistory) {
            continue;
        }

        const owner = await findAppUserById(snapshot.userId);
        const value: SharedPlayer = { nuid, owner: { username: owner?.username ?? null }, scopes };
        const fetchedAt: number[] = [];

        if (mayReadTtr) {
            const raw = snapshot.ttr ?? (snapshot.history ? { ttr: (snapshot.history as { ttr?: unknown }).ttr } : null);
            const at = snapshot.ttr ? snapshot.ttrFetchedAt : snapshot.historyFetchedAt;

            if (raw && at !== null) {
                value.ttr = {
                    ...toTtrData(nuid, PlayerTtrResponseSchema.parse(raw)),
                    fetchedAt: new Date(at).toISOString()
                };
                fetchedAt.push(at);
            }
        }

        if (mayReadHistory && snapshot.history && snapshot.historyFetchedAt !== null) {
            value.history = {
                ...toTtrHistoryData(nuid, PlayerTtrHistoryResponseSchema.parse(snapshot.history)),
                fetchedAt: new Date(snapshot.historyFetchedAt).toISOString()
            };
            fetchedAt.push(snapshot.historyFetchedAt);
        }

        if (fetchedAt.length === 0) {
            continue;
        }

        return {
            value,
            meta: {
                source: "snapshot",
                origin: "device",
                // Der älteste beteiligte Stand.
                fetchedAt: new Date(Math.min(...fetchedAt)).toISOString()
            }
        };
    }

    throw new SharedPlayerNotFoundError();
}
