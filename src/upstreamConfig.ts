import { readBooleanEnv, readNumberEnv } from "./config.js";

export const MYTT_BASE_URL =
    process.env.MYTT_BASE_URL ?? "https://www.mytischtennis.de";

export const upstreamEnabled = process.env.MYTT_UPSTREAM_ENABLED !== "false";

export const htmlFallbackEnabled = readBooleanEnv("MYTT_HTML_FALLBACK_ENABLED", true);

// Nur für Entwicklung: lässt die JSON API absichtlich scheitern, um den HTML Fallback zu testen.
export function isApiFailureForced() {
    return (
        process.env.NODE_ENV !== "production" &&
        readBooleanEnv("MYTT_FORCE_API_FAILURE", false)
    );
}

export const API_TIMEOUT_MS = () => readNumberEnv("MYTT_REQUEST_TIMEOUT_MS", 15000, { min: 1 });
export const HTML_TIMEOUT_MS = () => readNumberEnv("MYTT_HTML_TIMEOUT_MS", 5000, { min: 1 });
export const HTML_MAX_BYTES = () => readNumberEnv("MYTT_HTML_MAX_BYTES", 1_500_000, { min: 1 });

// /api/ttr/* läuft über die Session des Users und belastet das gemeinsame Limit nicht.
export function shouldCountTowardsLocalRateLimit(params: {
    path: string;
    countTowardsLocalRateLimit?: boolean;
}) {
    return params.countTowardsLocalRateLimit ?? !params.path.startsWith("/api/ttr/");
}
