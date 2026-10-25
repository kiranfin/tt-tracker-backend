import { config } from "../config.js";
import { markLoadOrigin } from "../cache/index.js";
import { writeJsonLog } from "../fileLogger.js";
import { getRequestContext } from "../requestContext.js";
import { UpstreamError, UpstreamFormatError } from "../upstream/errors.js";
import { trackSourceResult, type SourceKind } from "../upstream/tracker.js";
import { RemixContextParseError } from "./html/remixContext.js";

// Nur Fehler, bei denen der andere Weg etwas bringen kann. Nicht dazu gehören:
// - Session Fehler, abgeschaltetes Upstream und lokale Limits (Breaker, Stundenlimit): dieselbe Quelle gäbe dasselbe Ergebnis.
// - 4xx (z.B. 404): die Seite gäbe dieselbe Antwort, der Fallback würde nur Requests verdoppeln.
// - 429: der Breaker ist danach ohnehin offen.
// - Formatfehler, außer der Aufrufer hat einen unabhängigen zweiten Parser (fallbackOnFormatError).
function canFallBack(error: unknown, fallbackOnFormatError: boolean) {
    if (error instanceof UpstreamError) {
        return error.status === undefined || error.status >= 500;
    }

    if (error instanceof UpstreamFormatError || error instanceof RemixContextParseError) {
        return fallbackOnFormatError;
    }

    return false;
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
        errorMessage: params.error instanceof Error ? params.error.message : undefined,
        issues: params.error instanceof UpstreamFormatError ? params.error.issues : undefined
    });
}

async function runStep<T>(
    name: string,
    source: SourceKind,
    run: () => Promise<T>
): Promise<T> {
    try {
        if (source === "api" && config.upstream.forceApiFailure) {
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
    // Auch bei Formatfehlern (UpstreamFormatError, RemixContextParseError) den anderen Weg probieren.
    // Nur sinnvoll, wenn dessen Parser unabhängig vom ersten arbeitet.
    fallbackOnFormatError?: boolean;
}): Promise<T> {
    const primarySource = params.primarySource ?? "api";
    const fallbackSource: SourceKind = primarySource === "api" ? "html" : "api";

    try {
        return await runStep(params.name, primarySource, params.primary);
    } catch (primaryError) {
        if (!canFallBack(primaryError, params.fallbackOnFormatError ?? false)) {
            throw primaryError;
        }

        if (fallbackSource === "html" && !config.upstream.htmlFallbackEnabled) {
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
