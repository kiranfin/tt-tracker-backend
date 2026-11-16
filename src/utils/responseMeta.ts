import type { ReadThroughResult } from "../cache/index.js";

export function buildMeta(
    result: Pick<ReadThroughResult<unknown>, "source" | "origin" | "fetchedAt">,
    extra?: Record<string, unknown>
) {
    return {
        // "relay" ist nur eine Herkunft (origin): für die App ist ein frisch geladener Wert weiter "upstream".
        source: result.source === "relay" ? "upstream" : result.source,
        origin: result.origin,
        fetchedAt: result.fetchedAt,
        ...extra
    };
}
