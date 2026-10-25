import { ZodError } from "zod";
import { UpstreamFormatError } from "./errors.js";

const MAX_ISSUES = 10;

type Schema<T> = {
    parse: (value: unknown) => T;
};

/**
 * Prüft Daten von myTischtennis gegen ein Schema. Ein ZodError heißt hier immer, dass sich das
 * Format geändert hat (nicht, dass der Client etwas Falsches geschickt hat), daher UpstreamFormatError.
 */
export function parseUpstream<T>(schema: Schema<T>, value: unknown, source: string): T {
    try {
        return schema.parse(value);
    } catch (error) {
        if (error instanceof ZodError) {
            throw new UpstreamFormatError(
                source,
                error.issues
                    .slice(0, MAX_ISSUES)
                    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
            );
        }

        throw error;
    }
}
