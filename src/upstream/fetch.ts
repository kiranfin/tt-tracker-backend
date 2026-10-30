import { config } from "../config.js";
import { writeJsonLog } from "../fileLogger.js";
import { getRequestContext } from "../requestContext.js";
import {
    UpstreamChallengeError,
    UpstreamDisabledError,
    UpstreamError
} from "./errors.js";
import { getUpstreamPriority } from "./priority.js";
import {
    acquireUpstreamSlot,
    getUpstreamLane,
    parseRateLimitHeader,
    reportUpstreamResult
} from "./rateLimiter.js";
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
    // Standard true. false umgeht Warteschlange und Notbremse und ist nur noch für Ausnahmen gedacht.
    countTowardsLocalRateLimit?: boolean;
    logExtra?: Record<string, unknown>;
};

export type UpstreamTextResponse = {
    response: Response;
    bodyText: string;
    // URL nach allen Weiterleitungen.
    finalUrl: string;
};

const MAX_REDIRECTS = 3;

type FetchOutcome = {
    response: Response | null;
    finalUrl: string;
    // Erstes Weiterleitungsziel (Location oder x-remix-redirect), auch wenn es nicht /verify ist.
    redirectLocation?: string;
    // Ziel, wenn myTischtennis auf die Verifizierungsseite leitet.
    challengeLocation?: string;
    redirects: number;
};

function isCounted(request: UpstreamRequest) {
    return request.countTowardsLocalRateLimit ?? true;
}

function isVerifyLocation(location: string, base: URL) {
    try {
        const { pathname } = new URL(location, base);

        return pathname === "/verify" || pathname.startsWith("/verify/");
    } catch {
        return false;
    }
}

function isRedirectStatus(status: number) {
    return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/**
 * Folgt Weiterleitungen selbst (höchstens 3, nur gleiche Origin), damit eine Umleitung auf /verify
 * erkannt wird, bevor die Verifizierungsseite mit ihrem 429 wie ein Rate Limit aussieht.
 * Bei Challenge liefert sie response=null (bzw. die Weiterleitung) und challengeLocation.
 */
async function fetchFollowingRedirects(request: UpstreamRequest): Promise<FetchOutcome> {
    if (config.upstream.forceChallenge) {
        return {
            response: null,
            finalUrl: request.url.toString(),
            redirectLocation: "/verify?forced=1",
            challengeLocation: "/verify?forced=1",
            redirects: 1
        };
    }

    const signal = AbortSignal.timeout(request.timeoutMs);

    let url = request.url;
    let method = request.method;
    let body = request.body;
    let redirectLocation: string | undefined;
    let redirects = 0;

    while (true) {
        const response = await fetch(url, {
            method,
            headers: request.headers,
            body,
            signal,
            redirect: "manual"
        });

        // Remix beantwortet einen Redirect auf `?_data` Requests mit 204 und diesem Header.
        const remixRedirect = response.headers.get("x-remix-redirect");
        const location = remixRedirect ?? (isRedirectStatus(response.status) ? response.headers.get("location") : null);

        if (location) {
            redirectLocation ??= location;

            if (isVerifyLocation(location, url)) {
                await response.body?.cancel().catch(() => undefined);

                return {
                    response,
                    finalUrl: url.toString(),
                    redirectLocation,
                    challengeLocation: location,
                    redirects
                };
            }
        }

        if (!isRedirectStatus(response.status) || !location) {
            return { response, finalUrl: url.toString(), redirectLocation, redirects };
        }

        await response.body?.cancel().catch(() => undefined);

        redirects += 1;

        if (redirects > MAX_REDIRECTS) {
            throw new UpstreamError(`Upstream redirected more than ${MAX_REDIRECTS} times`);
        }

        const next = new URL(location, url);

        if (next.origin !== url.origin) {
            throw new UpstreamError(`Upstream redirected to another origin (${next.origin})`);
        }

        // Wie im Browser: 303 und POST nach 301/302 werden zu GET ohne Body.
        if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
            method = "GET";
            body = undefined;
        }

        url = next;
    }
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

    const priority = getUpstreamPriority();

    const logBase = {
        requestId: context?.requestId,
        priority,
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
        release = await acquireUpstreamSlot({ lane, counted, priority });
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
        const outcome = await fetchFollowingRedirects(request);

        response = outcome.response;

        const durationMs = Date.now() - startedAt;
        const retryAfterHeader = response?.headers.get("retry-after") ?? null;
        const rateLimitHeader = response?.headers.get("ratelimit") ?? null;
        const quota = parseRateLimitHeader(rateLimitHeader);

        void writeJsonLog("mytt_upstream_request", {
            ...logBase,
            status: response?.status,
            ok: response?.ok ?? false,
            durationMs,
            localRateLimitCounted: counted,
            // Roh und geparst: zeigt, wie viel Kontingent myTischtennis noch zugesteht.
            rateLimit: rateLimitHeader,
            rateLimitRemaining: quota?.remaining,
            rateLimitResetAt: quota ? new Date(quota.resetAt).toISOString() : undefined,
            retryAfter: retryAfterHeader,
            redirectLocation: outcome.redirectLocation,
            redirects: outcome.redirects || undefined,
            challenge: outcome.challengeLocation ? true : undefined,
            simulated: response ? undefined : true,
            ...request.logExtra
        });

        trackUpstreamRequest({
            method: request.method,
            path: request.path,
            url,
            status: response?.status,
            ok: response?.ok ?? false,
            durationMs
        });

        if (outcome.challengeLocation) {
            reportUpstreamResult({ lane, challenge: true });

            throw new UpstreamChallengeError(outcome.challengeLocation);
        }

        // Ohne Challenge hat fetchFollowingRedirects immer eine Response geliefert.
        const finalResponse = response as Response;

        reportUpstreamResult({
            lane,
            status: finalResponse.status,
            retryAfterHeader,
            rateLimitHeader
        });

        const bodyText =
            request.maxBytes !== undefined
                ? await readBodyLimited(finalResponse, request.maxBytes)
                : await finalResponse.text();

        return { response: finalResponse, bodyText, finalUrl: outcome.finalUrl };
    } catch (error) {
        if (error instanceof UpstreamChallengeError) {
            throw error;
        }

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
