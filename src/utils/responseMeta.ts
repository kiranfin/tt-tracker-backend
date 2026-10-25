import type { ReadThroughResult } from "../cache/index.js";

export function buildMeta(
    result: Pick<ReadThroughResult<unknown>, "source" | "origin" | "fetchedAt">,
    extra?: Record<string, unknown>
) {
    return {
        source: result.source,
        origin: result.origin,
        fetchedAt: result.fetchedAt,
        ...extra
    };
}
