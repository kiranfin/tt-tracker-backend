type UpstreamRequestEntry = {
    timestamp: number;
    method: "GET" | "POST";
    path: string;
    url: string;
    status?: number;
    ok: boolean;
    durationMs: number;
    errorName?: string;
    errorMessage?: string;
};

const upstreamRequests: UpstreamRequestEntry[] = [];

const WINDOW_MS = 60 * 60 * 1000;

function cleanupOldRequests() {
    const cutoff = Date.now() - WINDOW_MS;

    while (
        upstreamRequests.length > 0 &&
        upstreamRequests[0].timestamp < cutoff
        ) {
        upstreamRequests.shift();
    }
}

export function trackUpstreamRequest(entry: Omit<UpstreamRequestEntry, "timestamp">) {
    cleanupOldRequests();

    upstreamRequests.push({
        timestamp: Date.now(),
        ...entry
    });
}

export function getUpstreamUsage() {
    cleanupOldRequests();

    const now = Date.now();

    const byPath: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byMethod: Record<string, number> = {};

    for (const request of upstreamRequests) {
        byPath[request.path] = (byPath[request.path] ?? 0) + 1;
        byStatus[String(request.status ?? "ERROR")] =
            (byStatus[String(request.status ?? "ERROR")] ?? 0) + 1;
        byMethod[request.method] = (byMethod[request.method] ?? 0) + 1;
    }

    return {
        totalLastHour: upstreamRequests.length,
        byPath,
        byStatus,
        byMethod,
        recent: upstreamRequests.slice(-30).reverse().map((request) => ({
            ...request,
            ageSeconds: Math.round((now - request.timestamp) / 1000)
        }))
    };
}