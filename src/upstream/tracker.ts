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
    // Datenart (policies.ts), die den Request ausgelöst hat, und ihre Priorität.
    kind?: string;
    priority?: "interactive" | "background";
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

export type SourceKind = "api" | "html";

type SourceCounter = {
    ok: number;
    failed: number;
    lastOkAt: string | null;
    lastFailedAt: string | null;
    lastError: string | null;
};

// Zähler seit Prozessstart: pro Funktion und Quelle, damit eine dauerhaft kaputte API auffällt.
const sourceStats = new Map<string, Record<SourceKind, SourceCounter>>();

function emptyCounter(): SourceCounter {
    return { ok: 0, failed: 0, lastOkAt: null, lastFailedAt: null, lastError: null };
}

export function trackSourceResult(params: {
    name: string;
    source: SourceKind;
    ok: boolean;
    error?: unknown;
}) {
    let entry = sourceStats.get(params.name);

    if (!entry) {
        entry = { api: emptyCounter(), html: emptyCounter() };
        sourceStats.set(params.name, entry);
    }

    const counter = entry[params.source];
    const now = new Date().toISOString();

    if (params.ok) {
        counter.ok += 1;
        counter.lastOkAt = now;
        return;
    }

    counter.failed += 1;
    counter.lastFailedAt = now;
    counter.lastError =
        params.error instanceof Error
            ? `${params.error.name}: ${params.error.message}`
            : "Unknown error";
}

export function getUpstreamUsage() {
    cleanupOldRequests();

    const now = Date.now();

    const byPath: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    const byMethod: Record<string, number> = {};
    // Das Budget gilt für 30 Minuten: wofür wurde es in dieser Zeit verbraucht?
    const byKindLast30Min: Record<string, { interactive: number; background: number }> = {};
    const budgetCutoff = now - 30 * 60 * 1000;

    for (const request of upstreamRequests) {
        byPath[request.path] = (byPath[request.path] ?? 0) + 1;
        byStatus[String(request.status ?? "ERROR")] =
            (byStatus[String(request.status ?? "ERROR")] ?? 0) + 1;
        byMethod[request.method] = (byMethod[request.method] ?? 0) + 1;

        if (request.timestamp >= budgetCutoff) {
            const entry = (byKindLast30Min[request.kind ?? "other"] ??= { interactive: 0, background: 0 });

            entry[request.priority ?? "interactive"] += 1;
        }
    }

    return {
        totalLastHour: upstreamRequests.length,
        byPath,
        byStatus,
        byMethod,
        byKindLast30Min,
        sources: Object.fromEntries(sourceStats),
        recent: upstreamRequests.slice(-30).reverse().map((request) => ({
            ...request,
            ageSeconds: Math.round((now - request.timestamp) / 1000)
        }))
    };
}
