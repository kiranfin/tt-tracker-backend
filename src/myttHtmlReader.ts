import { getFromCache, setCache } from "./cache.js";
import { writeJsonLog } from "./fileLogger.js";
import { getRequestContext } from "./requestContext.js";
import { assertCanCallHtmlFallback } from "./rateLimiter.js";

const MYTT_BASE_URL =
    process.env.MYTT_BASE_URL ?? "https://www.mytischtennis.de";

const htmlFallbackEnabled = process.env.MYTT_HTML_FALLBACK_ENABLED !== "false";

type HtmlReadSource = "cache" | "html-upstream";

export type MyttHtmlReadResult = {
    html: string;
    meta: {
        source: HtmlReadSource;
        path: string;
        url: string;
        status?: number;
        durationMs?: number;
        cached: boolean;
    };
};

export class MyttHtmlDisabledError extends Error {
    constructor() {
        super("myTischtennis HTML fallback disabled");
        this.name = "MyttHtmlDisabledError";
    }
}

export class MyttHtmlRateLimitError extends Error {
    constructor() {
        super("myTischtennis HTML endpoint rate limited");
        this.name = "MyttHtmlRateLimitError";
    }
}

export class MyttHtmlError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "MyttHtmlError";
    }
}

function readPositiveNumberFromEnv(params: {
    key: string;
    fallback: number;
}): number {
    const raw = process.env[params.key];

    if (!raw || raw.trim() === "") {
        return params.fallback;
    }

    const parsed = Number(raw);

    if (!Number.isFinite(parsed) || parsed < 1) {
        console.warn(
            `Invalid ${params.key}="${raw}", falling back to ${params.fallback}`
        );
        return params.fallback;
    }

    return parsed;
}

function normalizeHtmlPath(input: string): string {
    const trimmed = input.trim();

    if (!trimmed) {
        throw new MyttHtmlError("HTML path must not be empty.");
    }

    const baseUrl = new URL(MYTT_BASE_URL);
    let url: URL;

    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
        url = new URL(trimmed);
    } else {
        if (!trimmed.startsWith("/")) {
            throw new MyttHtmlError(
                "HTML path must start with '/' or be a full myTischtennis URL."
            );
        }

        if (trimmed.startsWith("//")) {
            throw new MyttHtmlError("Protocol-relative URLs are not allowed.");
        }

        url = new URL(trimmed, MYTT_BASE_URL);
    }

    if (url.origin !== baseUrl.origin) {
        throw new MyttHtmlError("Only myTischtennis HTML URLs are allowed.");
    }

    return `${url.pathname}${url.search}`;
}

function buildHtmlHeaders(): Record<string, string> {
    return {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "de-DE,de;q=0.9,en;q=0.7",
        "user-agent":
            process.env.MYTT_HTML_USER_AGENT ??
            "TTTracker/0.1 private non-commercial backend"
    };
}

async function readResponseBodyLimited(response: Response): Promise<string> {
    const maxBytes = readPositiveNumberFromEnv({
        key: "MYTT_HTML_MAX_BYTES",
        fallback: 1_500_000
    });

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

        const chunk = Buffer.from(value);
        totalBytes += chunk.length;

        if (totalBytes > maxBytes) {
            throw new MyttHtmlError(
                `HTML response too large. Limit is ${maxBytes} bytes.`
            );
        }

        chunks.push(chunk);
    }

    return Buffer.concat(chunks).toString("utf8");
}

export async function readMyttHtml(params: {
    path: string;
    cacheKey?: string;
    ttlMs?: number;
}): Promise<MyttHtmlReadResult> {
    if (!htmlFallbackEnabled) {
        throw new MyttHtmlDisabledError();
    }

    const path = normalizeHtmlPath(params.path);
    const url = new URL(path, MYTT_BASE_URL);
    const urlString = url.toString();

    const cacheKey = params.cacheKey ?? `mytt-html:${path}`;

    const ttlMs =
        params.ttlMs ??
        readPositiveNumberFromEnv({
            key: "MYTT_HTML_CACHE_TTL_MS",
            fallback: 2 * 60 * 1000
        });

    const cached = ttlMs > 0 ? getFromCache<string>(cacheKey) : null;

    if (cached) {
        return {
            html: cached,
            meta: {
                source: "cache",
                path,
                url: urlString,
                cached: true
            }
        };
    }

    const context = getRequestContext();

    try {
        assertCanCallHtmlFallback();
    } catch (error) {
        void writeJsonLog("mytt_html_blocked", {
            requestId: context?.requestId,
            clientIp: context?.ip,
            backendMethod: context?.method,
            backendUrl: context?.url,
            reason: "local_html_rate_limit",
            myttPath: path,
            myttUrl: urlString
        });

        throw error;
    }

    const timeoutMs = readPositiveNumberFromEnv({
        key: "MYTT_HTML_TIMEOUT_MS",
        fallback: 5000
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const startedAt = Date.now();

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: buildHtmlHeaders(),
            redirect: "follow",
            signal: controller.signal
        });

        const durationMs = Date.now() - startedAt;
        const contentType = response.headers.get("content-type") ?? "";

        void writeJsonLog("mytt_html_request", {
            requestId: context?.requestId,
            clientIp: context?.ip,
            backendMethod: context?.method,
            backendUrl: context?.url,
            myttMethod: "GET",
            myttPath: path,
            myttUrl: urlString,
            status: response.status,
            ok: response.ok,
            contentType,
            durationMs
        });

        if (response.status === 429) {
            throw new MyttHtmlRateLimitError();
        }

        if (!response.ok) {
            throw new MyttHtmlError(`HTML upstream returned HTTP ${response.status}`);
        }

        if (!contentType.toLowerCase().includes("text/html")) {
            throw new MyttHtmlError(
                `Expected text/html but got "${contentType || "unknown"}"`
            );
        }

        const html = await readResponseBodyLimited(response);

        if (ttlMs > 0) {
            setCache(cacheKey, html, ttlMs);
        }

        return {
            html,
            meta: {
                source: "html-upstream",
                path,
                url: urlString,
                status: response.status,
                durationMs,
                cached: false
            }
        };
    } catch (error) {
        void writeJsonLog("mytt_html_error", {
            requestId: context?.requestId,
            clientIp: context?.ip,
            backendMethod: context?.method,
            backendUrl: context?.url,
            myttMethod: "GET",
            myttPath: path,
            myttUrl: urlString,
            durationMs: Date.now() - startedAt,
            errorName: error instanceof Error ? error.name : "UnknownError",
            errorMessage: error instanceof Error ? error.message : "Unknown error"
        });

        throw error;
    } finally {
        clearTimeout(timeout);
    }
}