import { config } from "../config.js";
import { writeJsonLog } from "../fileLogger.js";
import {
    markMyttSessionExpired,
    MyttSessionExpiredError,
    resolveMyttSessionForRequest,
    type MyttScope,
    type ResolvedMyttSession
} from "../myttSessionStore.js";
import { getRequestContext } from "../requestContext.js";
import { fetchWithFallback } from "../sources/fetchWithFallback.js";
import { getRouteDataFromPage } from "../sources/html/pageRoute.js";
import {
    UpstreamDisabledError,
    UpstreamError,
    UpstreamRateLimitError
} from "../upstream/errors.js";
import { fetchUpstreamText } from "../upstream/fetch.js";
import { parseUpstream } from "../upstream/parse.js";

type Schema<T> = {
    parse: (value: unknown) => T;
};

type JsonRequestParams<T> = {
    // Name der Quelle für Format Fehler, Standard ist der Pfad.
    name?: string;
    path: string;
    searchParams?: URLSearchParams;
    body?: URLSearchParams;
    schema: Schema<T>;
    authenticated?: boolean;
    requestingUserId?: string;
    requiredScope?: MyttScope;
    countTowardsLocalRateLimit?: boolean;
    extraHeaders?: Record<string, string>;
};

function buildHeaders(params: {
    method: "GET" | "POST";
    sessionCookie?: string;
    extraHeaders?: Record<string, string>;
}) {
    const headers: Record<string, string> = {
        accept: "application/json",
        ...(params.method === "POST"
            ? { "content-type": "application/x-www-form-urlencoded" }
            : {}),
        ...params.extraHeaders
    };

    if (params.sessionCookie) {
        headers.cookie = params.sessionCookie;
    }

    return headers;
}

function responseLooksLikeAuthExpired(response: Response, bodyText: string) {
    if ([401, 403, 419].includes(response.status)) {
        return true;
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (!contentType.includes("text/html")) {
        return false;
    }

    const lower = bodyText.toLowerCase();

    return (
        lower.includes('type="password"') &&
        (lower.includes("login") ||
            lower.includes("einloggen") ||
            lower.includes("anmelden"))
    );
}

function parseJsonBody(bodyText: string, path: string): unknown {
    try {
        return JSON.parse(bodyText);
    } catch {
        throw new UpstreamError(`Upstream returned non-JSON response for ${path}`);
    }
}

async function requestJson<T>(
    method: "GET" | "POST",
    params: JsonRequestParams<T>
): Promise<T> {
    if (!config.upstream.enabled) {
        throw new UpstreamDisabledError();
    }

    const context = getRequestContext();

    let session: ResolvedMyttSession | null = null;

    if (params.authenticated) {
        session = await resolveMyttSessionForRequest({
            requesterUserId: params.requestingUserId ?? context?.appUserId ?? "",
            requiredScope: params.requiredScope ?? "ttr:read"
        });
    }

    const url = new URL(`${config.upstream.baseUrl}${params.path}`);

    params.searchParams?.forEach((value, key) => {
        url.searchParams.set(key, value);
    });

    const startedAt = Date.now();

    try {
        const { response, bodyText } = await fetchUpstreamText({
            method,
            url,
            path: params.path,
            body: params.body,
            countTowardsLocalRateLimit: params.countTowardsLocalRateLimit,
            timeoutMs: config.upstream.requestTimeoutMs,
            headers: buildHeaders({
                method,
                sessionCookie: session?.cookie,
                extraHeaders: params.extraHeaders
            }),
            logExtra: {
                requesterUserId: session?.requesterUserId,
                sessionOwnerUserId: session?.sessionOwnerUserId,
                sessionMode: session?.mode
            }
        });

        if (session && responseLooksLikeAuthExpired(response, bodyText)) {
            await markMyttSessionExpired(session.sessionOwnerUserId);

            throw new MyttSessionExpiredError({
                sessionOwnerUserId: session.sessionOwnerUserId,
                delegated: session.mode === "delegated"
            });
        }

        if (response.status === 429) {
            throw new UpstreamRateLimitError();
        }

        if (!response.ok) {
            throw new UpstreamError(`Upstream returned HTTP ${response.status}`, response.status);
        }

        return parseUpstream(params.schema, parseJsonBody(bodyText, params.path), params.name ?? params.path);
    } catch (error) {
        void writeJsonLog("mytt_upstream_error", {
            requestId: context?.requestId,
            clientIp: context?.ip,
            backendMethod: context?.method,
            backendUrl: context?.url,
            myttMethod: method,
            myttPath: params.path,
            myttUrl: url.toString(),
            durationMs: Date.now() - startedAt,
            errorName: error instanceof Error ? error.name : "UnknownError",
            errorMessage: error instanceof Error ? error.message : "Unknown error"
        });

        throw error;
    }
}

export function postFormToMytt<T>(params: JsonRequestParams<T>): Promise<T> {
    return requestJson("POST", params);
}

export function getJsonFromMytt<T>(params: JsonRequestParams<T>): Promise<T> {
    return requestJson("GET", params);
}

/**
 * Seiten, die `?_data=<routeId>` kennen: JSON API zuerst, bei einem Fehler genau dieses Pfades
 * dieselben Loader Daten aus der normalen Webseite lesen.
 */
export function getRouteDataWithHtmlFallback<T>(params: {
    name: string;
    path: string;
    searchParams: URLSearchParams;
    schema: Schema<T>;
    extraHeaders?: Record<string, string>;
    // Plausibilitätsprüfung nach dem Schema, auf beiden Wegen. Wirft UpstreamFormatError.
    validate?: (value: T, source: string) => T;
}): Promise<T> {
    const routeId = params.searchParams.get("_data") ?? "";

    return fetchWithFallback({
        name: params.name,
        primary: async () => {
            const value = await getJsonFromMytt({
                name: params.name,
                path: params.path,
                searchParams: params.searchParams,
                schema: params.schema,
                extraHeaders: params.extraHeaders
            });

            return params.validate ? params.validate(value, params.name) : value;
        },
        fallback: async () => {
            const { routeData } = await getRouteDataFromPage({
                path: params.path,
                searchParams: params.searchParams,
                routeId
            });

            const value = parseUpstream(params.schema, routeData, `${params.name}:html`);

            return params.validate ? params.validate(value, `${params.name}:html`) : value;
        }
    });
}
