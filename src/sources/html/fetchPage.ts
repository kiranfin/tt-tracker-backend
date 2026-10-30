import { config } from "../../config.js";
import { UpstreamError, UpstreamRateLimitError } from "../../upstream/errors.js";
import { fetchUpstreamText } from "../../upstream/fetch.js";

const { baseUrl, html } = config.upstream;

const HTML_HEADERS = {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "de-DE,de;q=0.9,en;q=0.7",
    "user-agent": html.userAgent
};

/** Holt eine Seite von myTischtennis, über denselben Throttle und Breaker wie die API. */
export async function fetchHtmlPage(params: {
    path: string;
    searchParams?: URLSearchParams;
}): Promise<string> {
    return (await fetchHtmlPageWithUrl(params)).html;
}

/** Wie fetchHtmlPage, liefert zusätzlich die URL nach allen Weiterleitungen. */
export async function fetchHtmlPageWithUrl(params: {
    path: string;
    searchParams?: URLSearchParams;
}): Promise<{ html: string; finalUrl: string }> {
    const url = new URL(`${baseUrl}${params.path}`);

    params.searchParams?.forEach((value, key) => {
        url.searchParams.set(key, value);
    });

    const { response, bodyText, finalUrl } = await fetchUpstreamText({
        method: "GET",
        url,
        path: params.path,
        headers: HTML_HEADERS,
        timeoutMs: html.timeoutMs,
        maxBytes: html.maxBytes,
        logExtra: { kind: "html" }
    });

    if (response.status === 429) {
        throw new UpstreamRateLimitError();
    }

    if (!response.ok) {
        throw new UpstreamError(`Upstream returned HTTP ${response.status}`, response.status);
    }

    const contentType = response.headers.get("content-type") ?? "";

    if (!contentType.toLowerCase().includes("text/html")) {
        throw new UpstreamError(
            `Expected text/html for ${params.path} but got "${contentType || "unknown"}"`
        );
    }

    return { html: bodyText, finalUrl };
}
