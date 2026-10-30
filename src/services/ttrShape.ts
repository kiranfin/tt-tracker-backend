import type { PlayerTtrHistoryResponse, PlayerTtrResponse } from "../schemas.js";
import { hasAuthError } from "./compare.js";

/** Die Form, in der die App aktuellen TTR und Verlauf bekommt (aus der rohen myTischtennis Antwort). */
export function toTtrData(nuid: string, raw: PlayerTtrResponse) {
    return {
        nuid,
        available: !hasAuthError(raw) && raw.ttr != null,
        ttr: raw.ttr ?? null,
        error: raw.error ?? null
    };
}

export function toTtrHistoryData(nuid: string, raw: PlayerTtrHistoryResponse) {
    return {
        nuid,
        available: !hasAuthError(raw),
        ttr: raw.ttr ?? null,
        qttr: raw.vq_ttr ?? Number(raw.ttr_last_fixed) ?? null,
        qttrDate: raw.ttr_last_fixed_date ?? null,
        maxTtr: raw.max_ttr ?? null,
        ttrDate: raw.ttr_date ?? null,
        maxTtrDate: raw.max_ttr_date ?? null,
        clubName: raw.club_name ?? null,
        personName: raw.person_name ?? null,
        events: raw.event ?? [],
        error: raw.error ?? null
    };
}
