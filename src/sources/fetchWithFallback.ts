import { ZodError } from "zod";
import { markLoadOrigin } from "../cache.js";
import { writeJsonLog } from "../fileLogger.js";
import { getRequestContext } from "../requestContext.js";
import { htmlFallbackEnabled, isApiFailureForced } from "../upstreamConfig.js";
import { UpstreamError, UpstreamRateLimitError } from "../upstreamErrors.js";
import { trackSourceResult } from "../upstreamTracker.js";
import { RemixContextParseError } from "./html/remixContext.js";

type SourceKind = "api" | "html";

// Nur Fehler, bei denen genau dieser Pfad kaputt ist. Session Fehler, abgeschaltetes Upstream
// und lokale Limits (Breaker, Stundenlimit) gehen unverändert durch: dieselbe Quelle gäbe dasselbe Ergebnis.
function canFallBack(error: unknown) {
    return (
        error instanceof UpstreamError ||
        error instanceof UpstreamRateLimitError ||
        error instanceof ZodError ||
        error instanceof RemixContextParseError
    );
}

function logSource(params: {
    name: string;
    source: SourceKind;
    ok: boolean;
    error?: unknown;
}) {
    trackSourceResult(params);

    const context = getRequestContext();

    void writeJsonLog("source_result", {
        requestId: context?.requestId,
        name: params.name,
        source: params.source,
        ok: params.ok,
        errorName: params.error instanceof Error ? params.error.name : undefined,
        errorMessage: params.error instanceof Error ? params.error.message : undefined
    });
}

async function runStep<T>(
    name: string,
    source: SourceKind,
    run: () => Promise<T>
): Promise<T> {
    try {
        if (source === "api" && isApiFailureForced()) {
            throw new UpstreamError("API failure forced by MYTT_FORCE_API_FAILURE");
        }

        const value = await run();

        logSource({ name, source, ok: true });

        return value;
    } catch (error) {
        logSource({ name, source, ok: false, error });

        throw error;
    }
}

/**
 * Probiert `primary`, bei einem Fehler genau dieses Pfades danach `fallback`.
 * Standard ist API zuerst, Webseite als Fallback. Für Seiten, bei denen die Webseite der
 * Hauptweg ist (Ligatabelle), mit primarySource: "html" umdrehen.
 *
 * Kommt der Wert vom HTML Fallback, wird das am laufenden readThrough als Herkunft "html" vermerkt.
 * Scheitern beide, wird der Fehler des API Weges geworfen.
 */
export async function fetchWithFallback<T>(params: {
    name: string;
    primary: () => Promise<T>;
    fallback: () => Promise<T>;
    primarySource?: SourceKind;
}): Promise<T> {
    const primarySource = params.primarySource ?? "api";
    const fallbackSource: SourceKind = primarySource === "api" ? "html" : "api";

    try {
        return await runStep(params.name, primarySource, params.primary);
    } catch (primaryError) {
        if (!canFallBack(primaryError)) {
            throw primaryError;
        }

        if (fallbackSource === "html" && !htmlFallbackEnabled) {
            throw primaryError;
        }

        try {
            const value = await runStep(params.name, fallbackSource, params.fallback);

            if (fallbackSource === "html") {
                markLoadOrigin("html");
            }

            return value;
        } catch (fallbackError) {
            // Den Fehler der API Seite werfen, den kennt handleApiError.
            throw primarySource === "api" ? primaryError : fallbackError;
        }
    }
}
