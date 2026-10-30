import { config } from "../config.js";
import { writeJsonLog } from "../fileLogger.js";
import { getRequestContext } from "../requestContext.js";
import { UpstreamDisabledError, UpstreamError } from "./errors.js";
import { acquireUpstreamSlot, getUpstreamLane, reportUpstreamResult } from "./rateLimiter.js";
import { trackUpstreamRequest } from "./tracker.js";

export type UpstreamRequest = {
    method: "GET" | "POST";
    url: URL;
    // Pfad ohne Query, für Logs und Statistik.
    path: string;
    headers: Record<string, string>;
    body?: URLSearchParams;
    timeoutMs: number;
    // Abbruch, wenn die Antwort größer ist (nur Webseiten).
    maxBytes?: number;
    // /api/ttr/* läuft über die Session des Users und belastet das gemeinsame Limit nicht.
    countTowardsLocalRateLimit?: boolean;
    logExtra?: Record<string, unknown>;
};

export type UpstreamTextResponse = {
    response: Response;
    bodyText: string;
};

function isCounted(request: UpstreamRequest) {
    return request.countTowardsLocalRateLimit ?? !request.path.startsWith("/api/ttr/");
}

async function readBodyLimited(response: Response, maxBytes: number): Promise<string> {
    if (!response.body) {
        return "";
    }

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    while (true) {
        const { done, value } = await reader.read();

        if (done) {
            break;
        }

        totalBytes += value.byteLength;

        if (totalBytes > maxBytes) {
            await reader.cancel().catch(() => undefined);
            throw new UpstreamError(`Upstream response too large. Limit is ${maxBytes} bytes.`);
        }

        chunks.push(Buffer.from(value));
    }

    return Buffer.concat(chunks).toString("utf8");
}

function toUpstreamError(error: unknown, timeoutMs: number) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
        return new UpstreamError(`Upstream timed out after ${timeoutMs}ms`);
    }

    return new UpstreamError(
        `Upstream request failed: ${error instanceof Error ? error.message : "unknown error"}`
    );
}

/**
 * Einziger Weg zu myTischtennis: Warteschlange, Notbremse, Timeout, Logging, Statistik und
 * Meldung an den Circuit Breaker. Fehlerstatus (429, 5xx) wirft diese Funktion nicht,
 * das entscheidet der Aufrufer anhand der Response.
 */
export async function fetchUpstreamText(request: UpstreamRequest): Promise<UpstreamTextResponse> {
    if (!config.upstream.enabled) {
        throw new UpstreamDisabledError();
    }

    const context = getRequestContext();
    const url = request.url.toString();

    const logBase = {
        requestId: context?.requestId,
        clientIp: context?.ip,
        backendMethod: context?.method,
        backendUrl: context?.url,
        myttMethod: request.method,
        myttPath: request.path,
        myttUrl: url
    };

    const counted = isCounted(request);
    const lane = getUpstreamLane(request.path);
    let release: () => void;

    try {
        release = await acquireUpstreamSlot({ lane, counted });
    } catch (error) {
        void writeJsonLog("mytt_upstream_blocked", {
            ...logBase,
            reason: (error as { reason?: string }).reason ?? "unknown"
        });

        throw error;
    }

    const startedAt = Date.now();
    let response: Response | null = null;

    try {
        response = await fetch(request.url, {
            method: request.method,
            headers: request.headers,
            body: request.body,
            signal: AbortSignal.timeout(request.timeoutMs)
        });

        const durationMs = Date.now() - startedAt;
        const retryAfterHeader = response.headers.get("retry-after");
        const rateLimitHeader = response.headers.get("ratelimit");

        void writeJsonLog("mytt_upstream_request", {
            ...logBase,
            status: response.status,
            ok: response.ok,
            durationMs,
            localRateLimitCounted: counted,
            // Nur bei 429: zeigt, welches Limit von myTischtennis gegriffen hat.
            ...(response.status === 429
                ? { retryAfter: retryAfterHeader, rateLimit: rateLimitHeader }
                : {}),
            ...request.logExtra
        });

        trackUpstreamRequest({
            method: request.method,
            path: request.path,
            url,
            status: response.status,
            ok: response.ok,
            durationMs
        });

        reportUpstreamResult({
            lane,
            status: response.status,
            retryAfterHeader,
            rateLimitHeader
        });

        const bodyText =
            request.maxBytes !== undefined
                ? await readBodyLimited(response, request.maxBytes)
                : await response.text();

        return { response, bodyText };
    } catch (error) {
        if (response) {
            // Header kamen an, der Body nicht rechtzeitig: gleiche Behandlung wie ein Timeout vor der Antwort.
            // Alles andere (z.B. "too large") ist schon ein UpstreamError und bleibt unverändert.
            if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
                reportUpstreamResult({ lane, networkError: true });

                throw toUpstreamError(error, request.timeoutMs);
            }

            throw error;
        }

        // Keine Response (Timeout, DNS, Verbindungsabbruch): zählt für den Breaker wie ein 5xx.
        reportUpstreamResult({ lane, networkError: true });

        trackUpstreamRequest({
            method: request.method,
            path: request.path,
            url,
            ok: false,
            durationMs: Date.now() - startedAt,
            errorName: error instanceof Error ? error.name : "UnknownError",
            errorMessage: error instanceof Error ? error.message : "Unknown error"
        });

        throw toUpstreamError(error, request.timeoutMs);
    } finally {
        release();
    }
}
