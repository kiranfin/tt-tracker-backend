import { cacheKeys } from "../cacheKeys.js";
import { getPlayerHeadToHead, getPlayerTtr, getPlayerTtrHistory } from "../mytt/player.js";
import { resolveMyttSessionForRequest, type MyttScope } from "../myttSessionStore.js";
import type { DataKind } from "../policies.js";
import { toHeadToHeadOtherUser } from "../utils/nuid.js";
import {
    buildComparison,
    buildHeadToHeadStats,
    buildPlayerSnapshot,
    buildSummary,
    errorToResponse,
    hasAuthError
} from "./compare.js";
import { readByPolicy, type ResponseMeta, type ServiceResult } from "./read.js";
import { toTtrData, toTtrHistoryData } from "./ttrShape.js";

// Persönliche TTR Daten über die myTT Session eines Users. Dieser Weg fällt mit der Umstellung auf
// Snapshots vom Gerät weg (Phase 4), bis dahin läuft er unverändert über den Server.

/** Antwort mit `error` Feld: wird nicht gecacht, ein älterer guter Cache Eintrag hat Vorrang. */
class ErrorPayload<T> extends Error {
    constructor(readonly value: T) {
        super("myTischtennis returned an error payload");
        this.name = "ErrorPayload";
    }
}

/**
 * TTR Daten über den Cache, damit bei einer Störung von myTischtennis der letzte Stand kommt.
 * Der Zugriff (eigene oder freigegebene myTT Session) wird vor dem Cache geprüft, damit ein
 * Treffer nichts an User ohne Berechtigung ausliefert.
 */
async function readTtrData<T extends { error?: unknown }>(params: {
    requestingUserId: string;
    scope: MyttScope;
    kind: DataKind;
    key: string;
    load: () => Promise<T>;
}): Promise<ServiceResult<T>> {
    await resolveMyttSessionForRequest({
        requesterUserId: params.requestingUserId,
        requiredScope: params.scope
    });

    try {
        return await readByPolicy({
            kind: params.kind,
            key: params.key,
            load: async () => {
                const value = await params.load();

                if (value.error !== null && value.error !== undefined) {
                    throw new ErrorPayload(value);
                }

                return value;
            }
        });
    } catch (error) {
        if (error instanceof ErrorPayload) {
            return {
                value: error.value as T,
                meta: {
                    source: "upstream",
                    origin: "upstream",
                    fetchedAt: new Date().toISOString()
                }
            };
        }

        throw error;
    }
}

function readPlayerTtr(requestingUserId: string, nuid: string) {
    return readTtrData({
        requestingUserId,
        scope: "ttr:read",
        kind: "PLAYER_TTR",
        key: cacheKeys.playerTtr(nuid),
        load: () => getPlayerTtr({ requestingUserId, nuid })
    });
}

function readPlayerTtrHistory(requestingUserId: string, nuid: string) {
    return readTtrData({
        requestingUserId,
        scope: "ttr_history:read",
        kind: "PLAYER_TTR_HISTORY",
        key: cacheKeys.playerTtrHistory(nuid),
        load: () => getPlayerTtrHistory({ requestingUserId, nuid })
    });
}

export async function getPersonalTtr(requestingUserId: string, nuid: string) {
    const cached = await readPlayerTtr(requestingUserId, nuid);

    return { value: toTtrData(nuid, cached.value), meta: cached.meta };
}

export async function getPersonalTtrHistory(requestingUserId: string, nuid: string) {
    const cached = await readPlayerTtrHistory(requestingUserId, nuid);

    return { value: toTtrHistoryData(nuid, cached.value), meta: cached.meta };
}

export async function getHeadToHead(requestingUserId: string, nuid: string, otherUser: string) {
    const result = await getPlayerHeadToHead({ requestingUserId, otherUser });

    return {
        value: {
            nuid,
            otherUser,
            available: !hasAuthError(result),
            items: Array.isArray(result.data) ? result.data : [],
            error: result.error ?? null
        },
        meta: { source: "upstream" } satisfies ResponseMeta
    };
}

type HeadToHeadBlock = {
    available: boolean;
    perspective: {
        requestedLeftNuid: string;
        requestedRightNuid: string;
        upstreamOtherUser: string;
        note: string;
    };
    stats: ReturnType<typeof buildHeadToHeadStats>;
    items: unknown[];
    error: unknown | null;
};

/** `onWarn` meldet, wenn nur der Head to Head Block fehlt (TTR und Verlauf bleiben nutzbar). */
export async function comparePlayers(
    requestingUserId: string,
    leftNuid: string,
    rightNuid: string,
    onWarn?: (info: Record<string, unknown>, message: string) => void
) {
    const [leftTtr, rightTtr, leftHistory, rightHistory] = await Promise.all([
        readPlayerTtr(requestingUserId, leftNuid),
        readPlayerTtr(requestingUserId, rightNuid),
        readPlayerTtrHistory(requestingUserId, leftNuid),
        readPlayerTtrHistory(requestingUserId, rightNuid)
    ]);

    const left = buildPlayerSnapshot({
        nuid: leftNuid,
        ttrResult: leftTtr.value,
        historyResult: leftHistory.value
    });

    const right = buildPlayerSnapshot({
        nuid: rightNuid,
        ttrResult: rightTtr.value,
        historyResult: rightHistory.value
    });

    const comparison = buildComparison(left, right);

    const otherUser = toHeadToHeadOtherUser(rightNuid);
    let headToHead: HeadToHeadBlock;

    try {
        const headToHeadResult = await getPlayerHeadToHead({ requestingUserId, otherUser });

        const items = Array.isArray(headToHeadResult.data) ? headToHeadResult.data : [];

        headToHead = {
            available: !hasAuthError(headToHeadResult),
            perspective: {
                requestedLeftNuid: leftNuid,
                requestedRightNuid: rightNuid,
                upstreamOtherUser: otherUser,
                note:
                    "myTischtennis liefert Head-to-Head nur aus Sicht des eingeloggten myTischtennis-Users gegen other_user. Dieser Block passt also nur exakt zum Paar, wenn die erste NUID dem eingeloggten myTischtennis-User entspricht."
            },
            stats: buildHeadToHeadStats(items),
            items,
            error: headToHeadResult.error ?? null
        };
    } catch (error) {
        onWarn?.(
            { error: errorToResponse(error), leftNuid, rightNuid },
            "Player compare head-to-head unavailable"
        );

        headToHead = {
            available: false,
            perspective: {
                requestedLeftNuid: leftNuid,
                requestedRightNuid: rightNuid,
                upstreamOtherUser: otherUser,
                note:
                    "Head-to-Head konnte nicht geladen werden. TTR- und History-Vergleich bleiben trotzdem verfügbar."
            },
            stats: buildHeadToHeadStats([]),
            items: [],
            error: errorToResponse(error)
        };
    }

    return {
        value: {
            left,
            right,
            comparison,
            summary: buildSummary(left, right, comparison),
            headToHead
        },
        meta: {
            source: "upstream",
            generatedAt: new Date().toISOString()
        } satisfies ResponseMeta
    };
}
