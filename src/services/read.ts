import { readThrough, type ReadThroughResult } from "../cache/index.js";
import { DATA_POLICIES, getFreshMs, type DataKind } from "../policies.js";
import { runInBackground } from "../upstream/priority.js";
import { buildMeta } from "../utils/responseMeta.js";

/** Das `meta` Objekt jeder Antwort: Herkunft und Alter der Daten, je nach Datenart mit Zusatzfeldern. */
export type ResponseMeta = { source: string; [key: string]: unknown };

/** Was jeder Service liefert: die Daten (so, wie die Route sie als `data` sendet) und ihr Meta. */
export type ServiceResult<T> = { value: T; meta: ResponseMeta };

export function toServiceResult<T>(
    result: Pick<ReadThroughResult<T>, "value" | "source" | "origin" | "fetchedAt">,
    extraMeta?: Record<string, unknown>
): ServiceResult<T> {
    return { value: result.value, meta: buildMeta(result, extraMeta) };
}

/**
 * Liest eine Datenart über den Cache. Frische, Notnagel und Priorität kommen aus der Policy Tabelle,
 * der Cache Key vom Aufrufer (aus cacheKeys.ts).
 */
export async function readByPolicy<T>(params: {
    kind: DataKind;
    key: string;
    load: () => Promise<T>;
    // Zusatzfelder fürs Meta, abhängig vom Wert (z.B. die Cache Dauer eines Spielberichts).
    extraMeta?: (value: T) => Record<string, unknown>;
}): Promise<ServiceResult<T>> {
    const priority = DATA_POLICIES[params.kind].priority;

    const result = await readThrough({
        key: params.key,
        ttlMs: (value: T) => getFreshMs(params.kind, value),
        load: priority === "background" ? () => runInBackground(params.load) : params.load
    });

    return toServiceResult(result, params.extraMeta?.(result.value));
}
