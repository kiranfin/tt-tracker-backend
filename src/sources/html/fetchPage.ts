import { fetchUpstreamText } from "../../upstreamFetch.js";
import {
    HTML_MAX_BYTES,
    HTML_TIMEOUT_MS,
    MYTT_BASE_URL
} from "../../upstreamConfig.js";
import { UpstreamError, UpstreamRateLimitError } from "../../upstreamErrors.js";

function buildHtmlHeaders(): Record<string, string> {
    return {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "de-DE,de;q=0.9,en;q=0.7",
        "user-agent":
            process.env.MYTT_HTML_USER_AGENT ??
            "Mozilla/5.0 (compatible; TischtennisTracker/1.0)"
    };
}

/**
 * Holt eine Seite von myTischtennis. Läuft über denselben Throttle und Breaker wie die API.
 */
export async function fetchHtmlPage(params: {
    path: string;
    searchParams?: URLSearchParams;
}): Promise<string> {
    const url = new URL(`${MYTT_BASE_URL}${params.path}`);

    params.searchParams?.forEach((value, key) => {
        url.searchParams.set(key, value);
    });

    const { response, bodyText } = await fetchUpstreamText({
        method: "GET",
        url,
        path: params.path,
        headers: buildHtmlHeaders(),
        timeoutMs: HTML_TIMEOUT_MS(),
        maxBytes: HTML_MAX_BYTES(),
        logExtra: { kind: "html" }
    });

    if (response.status === 429) {
        throw new UpstreamRateLimitError();
    }

    if (!response.ok) {
        throw new UpstreamError(`Upstream returned HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (!contentType.toLowerCase().includes("text/html")) {
        throw new UpstreamError(
            `Expected text/html for ${params.path} but got "${contentType || "unknown"}"`
        );
    }

    return bodyText;
}
