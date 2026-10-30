import { AsyncLocalStorage } from "node:async_hooks";

/**
 * "interactive": ein Nutzer wartet auf die Antwort. "background": Vorarbeit wie die Berichte der
 * TTR Schätzung oder die Canary Probes, die ruhig länger warten darf.
 */
export type UpstreamPriority = "interactive" | "background";

/*
 * Bekannte Grenze: hängt sich eine Nutzeranfrage über die In-flight Dedupe von readThrough an einen
 * laufenden Hintergrund Load, wartet sie mit dessen Priorität. Das passiert selten und ist so gewollt.
 */
const priorityStorage = new AsyncLocalStorage<UpstreamPriority>();

/** Führt `fn` mit Hintergrund Priorität aus. Alle Upstream Requests darin gelten als Hintergrundarbeit. */
export function runInBackground<T>(fn: () => Promise<T>): Promise<T> {
    return priorityStorage.run("background", fn);
}

export function getUpstreamPriority(): UpstreamPriority {
    return priorityStorage.getStore() ?? "interactive";
}
