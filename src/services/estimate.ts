import { cacheKeys } from "../cacheKeys.js";
import { estimatePlayerTtr } from "../rating/playerEstimate.js";
import { readByPolicy } from "./read.js";

/** Geschätzter TTR und Verlauf aus öffentlichen Spielberichten, ohne myTischtennis Login. */
export function getPlayerTtrEstimate(params: {
    nuid: string;
    organization: string;
    clubNumber: string;
    clubName?: string;
    name?: string;
}) {
    return readByPolicy({
        kind: "PLAYER_TTR_ESTIMATE",
        key: cacheKeys.playerTtrEstimate(
            params.nuid,
            params.organization,
            params.clubNumber,
            params.name
        ),
        load: () => estimatePlayerTtr(params)
    });
}
