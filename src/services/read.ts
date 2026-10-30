import { peekUsableCached, readThrough, type ReadThroughResult } from "../cache/index.js";
import { DATA_POLICIES, getFreshMs, type DataKind, type FreshContext } from "../policies.js";
import { getMatchWindow, type MatchWindow } from "../sources/scheduleDates.js";
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
 * Liest eine Datenart über den Cache. Frische, Notnagel, stale-while-revalidate und Priorität kommen
 * aus der Policy Tabelle, der Cache Key vom Aufrufer (aus cacheKeys.ts).
 *
 * Ein abgelaufener Eintrag wird sofort geliefert und im Hintergrund über die Warteschlange
 * aktualisiert. Nur ein echter Cache Miss wartet auf myTischtennis.
 */
export async function readByPolicy<T>(params: {
    kind: DataKind;
    key: string;
    load: () => Promise<T>;
    // Zusatzfelder fürs Meta, abhängig vom Wert (z.B. die Cache Dauer eines Spielberichts).
    extraMeta?: (value: T) => Record<string, unknown>;
    // Zusatzwissen für die Frische, wird erst beim Speichern des geladenen Werts ausgewertet.
    freshContext?: () => FreshContext;
}): Promise<ServiceResult<T>> {
    const policy = DATA_POLICIES[params.kind];
    const { load } = params;

    const result = await readThrough({
        key: params.key,
        ttlMs: (value: T) => getFreshMs(params.kind, value, params.freshContext?.()),
        staleMaxMs: policy.staleMax,
        swr: policy.swr,
        load: policy.priority === "background" ? () => runInBackground(load) : load,
        refreshLoad: () => runInBackground(load)
    });

    return toServiceResult(result, params.extraMeta?.(result.value));
}

/**
 * Terminfenster aus einem schon gecachten Spielplan. Tabelle und Bilanzen enthalten keine Termine,
 * sie richten sich nach dem Spielplan derselben Liga oder Mannschaft. Ist der nicht im Cache, fehlt
 * das Wissen (null) und die Datenart bleibt bei ihrer kurzen Standard Frische.
 */
export function matchWindowFromCachedSchedule<T>(
    scheduleKey: string,
    dates: (schedule: T) => unknown[]
): MatchWindow | null {
    const schedule = peekUsableCached<T>(scheduleKey);

    return schedule ? getMatchWindow(dates(schedule), Date.now()) : null;
}
