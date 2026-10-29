import type { ClubPlayer } from "../schemas.js";
import { asNullableNumber } from "./values.js";

export type PlayerRatingSource = "public" | "estimated" | "official";

export type PlayerRating = {
    value: number;
    source: PlayerRatingSource;
    /** Zeitpunkt, zu dem der Wert von myTischtennis geladen wurde. */
    asOf: string;
};

/** "NU485630", "nu485630" und "485630" bezeichnen denselben Spieler. */
export function normalizePlayerId(value: string | null | undefined) {
    const id = value?.trim().toUpperCase() ?? "";

    return id.startsWith("NU") ? id.slice(2) : id;
}

export function findPlayerInClubList(players: ClubPlayer[], nuid: string) {
    const wanted = normalizePlayerId(nuid);

    if (!wanted) {
        return null;
    }

    return (
        players.find(
            (player) =>
                normalizePlayerId(player.person_id) === wanted ||
                normalizePlayerId(player.internal_id) === wanted
        ) ?? null
    );
}

export function toPublicRating(
    player: ClubPlayer,
    asOf: string
): PlayerRating | null {
    const value = asNullableNumber(player.ttr);

    if (value === null) {
        return null;
    }

    return { value, source: "public", asOf };
}
