import { writeJsonLog } from "./fileLogger.js";
import { getRequestContext } from "./requestContext.js";
import { acquireUpstreamSlot, reportUpstreamResult } from "./rateLimiter.js";
import { trackUpstreamRequest } from "./upstreamTracker.js";
import { shouldCountTowardsLocalRateLimit, upstreamEnabled } from "./upstreamConfig.js";
import { UpstreamDisabledError, UpstreamError } from "./upstreamErrors.js";

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

/**
 * Einziger Weg zu myTischtennis: Throttle (Warteschlange), Breaker Meldung, Timeout,
 * Logging und Tracking sind hier zentral. Fehlerstatus (429, 5xx) wirft diese Funktion nicht,
 * das entscheidet der Aufrufer anhand der Response.
 */
export async function fetchUpstreamText(params: {
    method: "GET" | "POST";
    url: URL;
    headers: Record<string, string>;
    body?: URLSearchParams;
    path: string;
    countTowardsLocalRateLimit?: boolean;
    timeoutMs: number;
    maxBytes?: number;
    logExtra?: Record<string, unknown>;
}): Promise<{ response: Response; bodyText: string }> {
    if (!upstreamEnabled) {
        throw new UpstreamDisabledError();
    }

    const context = getRequestContext();
    const counted = shouldCountTowardsLocalRateLimit(params);
    const urlString = params.url.toString();

    const logBase = {
        requestId: context?.requestId,
        clientIp: context?.ip,
        backendMethod: context?.method,
        backendUrl: context?.url,
        myttMethod: params.method,
        myttPath: params.path,
        myttUrl: urlString
    };

    let release: () => void;

    try {
        release = await acquireUpstreamSlot({ counted });
    } catch (error) {
        void writeJsonLog("mytt_upstream_blocked", {
            ...logBase,
            reason:
                error instanceof Error && "reason" in error
                    ? (error as { reason: string }).reason
                    : "unknown"
        });

        throw error;
    }

    const startedAt = Date.now();
    let response: Response | null = null;

    try {
        response = await fetch(params.url, {
            method: params.method,
            headers: params.headers,
            body: params.body,
            redirect: "follow",
            signal: AbortSignal.timeout(params.timeoutMs)
        });

        const status = response.status;

        void writeJsonLog("mytt_upstream_request", {
            ...logBase,
            status,
            ok: response.ok,
            durationMs: Date.now() - startedAt,
            localRateLimitCounted: counted,
            ...params.logExtra
        });

        trackUpstreamRequest({
            method: params.method,
            path: params.path,
            url: urlString,
            status,
            ok: response.ok,
            durationMs: Date.now() - startedAt
        });

        reportUpstreamResult({
            status,
            retryAfterHeader: response.headers.get("retry-after")
        });

        const bodyText =
            params.maxBytes !== undefined
                ? await readBodyLimited(response, params.maxBytes)
                : await response.text();

        return { response, bodyText };
    } catch (error) {
        if (!response) {
            // Kein Response: Timeout, DNS, Verbindungsabbruch. Zählt für den Breaker wie ein 5xx.
            reportUpstreamResult({ networkError: true });

            trackUpstreamRequest({
                method: params.method,
                path: params.path,
                url: urlString,
                ok: false,
                durationMs: Date.now() - startedAt,
                errorName: error instanceof Error ? error.name : "UnknownError",
                errorMessage: error instanceof Error ? error.message : "Unknown error"
            });

            if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
                throw new UpstreamError(`Upstream timed out after ${params.timeoutMs}ms`);
            }

            throw new UpstreamError(
                `Upstream request failed: ${error instanceof Error ? error.message : "unknown error"}`
            );
        }

        throw error;
    } finally {
        release();
    }
}
