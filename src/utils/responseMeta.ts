import type { ReadThroughResult } from "../cache/index.js";

export function buildMeta(
    result: Pick<ReadThroughResult<unknown>, "source" | "fetchedAt">,
    extra?: Record<string, unknown>
) {
    return {
        source: result.source,
        fetchedAt: result.fetchedAt,
        ...extra
    };
}
