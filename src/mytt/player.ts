import { PlayerTtrHistoryResponseSchema, PlayerTtrResponseSchema } from "../schemas.js";
import type { PlayerTtrHistoryResponse, PlayerTtrResponse } from "../schemas.js";
import { getJsonFromMytt, postFormToMytt } from "./request.js";
import { asRecord } from "./values.js";

export type PlayerHeadToHeadResponse = {
    data: unknown[];
    error: unknown | null;
};

function normalizePlayerHeadToHeadResponse(value: unknown): PlayerHeadToHeadResponse {
    const root = asRecord(value);

    return {
        data: Array.isArray(root.data) ? root.data : [],
        error: root.error ?? null
    };
}

export async function getPlayerTtr(params: {
    requestingUserId: string;
    nuid: string;
}): Promise<PlayerTtrResponse> {
    return getJsonFromMytt({
        path: `/api/ttr/player/${encodeURIComponent(params.nuid)}`,
        schema: PlayerTtrResponseSchema,
        authenticated: true,
        requestingUserId: params.requestingUserId,
        requiredScope: "ttr:read",
        countTowardsLocalRateLimit: false
    });
}

export async function getPlayerTtrHistory(params: {
    requestingUserId: string;
    nuid: string;
}): Promise<PlayerTtrHistoryResponse> {
    return getJsonFromMytt({
        path: `/api/ttr/history/${encodeURIComponent(params.nuid)}`,
        schema: PlayerTtrHistoryResponseSchema,
        authenticated: true,
        requestingUserId: params.requestingUserId,
        requiredScope: "ttr_history:read",
        countTowardsLocalRateLimit: false
    });
}

export async function getPlayerHeadToHead(params: {
    requestingUserId: string;
    otherUser: string;
}): Promise<PlayerHeadToHeadResponse> {
    const body = new URLSearchParams({
        other_user: params.otherUser
    });

    return postFormToMytt({
        path: "/api/head-to-head",
        body,
        schema: {
            parse: normalizePlayerHeadToHeadResponse
        },
        authenticated: true,
        requestingUserId: params.requestingUserId,
        requiredScope: "ttr:read",
        countTowardsLocalRateLimit: false
    });
}
