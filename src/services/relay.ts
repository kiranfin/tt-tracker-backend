import { z } from "zod";
import { config } from "../config.js";
import type { RelayRequest } from "../relayTypes.js";
import { RelayThrottledError } from "../upstream/errors.js";
import { allowRelayUpload, getRelayStatus, storeRelayResponses } from "../upstream/relay.js";

export { getRelayStatus };

/** Upload der App: Rohantworten von myTischtennis zu Requests, die das Backend vorher gemeldet hat. */
export const RelayUploadSchema = z.object({
    responses: z
        .array(
            z.object({
                id: z.string().min(1).max(2000),
                status: z.number().int(),
                contentType: z.string().max(200),
                // Zeichen statt Bytes als grobe Grenze, die genaue Prüfung (Bytes) macht storeRelayResponses.
                body: z.string().max(config.relay.maxBodyBytes),
                finalUrl: z.string().max(2000),
                remixError: z.boolean().optional()
            })
        )
        .min(1)
        .max(config.relay.maxResponsesPerUpload)
});

export type RelayUploadBody = z.infer<typeof RelayUploadSchema>;

/** "user:<id>" für eingeloggte Nutzer, sonst "ip:<ip>". Dieselbe Regel für Abruf und Upload. */
export function buildRelayUploader(userId: string | null | undefined, ip: string): string {
    return userId ? `user:${userId}` : `ip:${ip}`;
}

export function acceptRelayUpload(uploader: string, body: unknown): { accepted: number } {
    const upload = RelayUploadSchema.parse(body);

    if (!allowRelayUpload(uploader, upload.responses.length)) {
        throw new RelayThrottledError();
    }

    return { accepted: storeRelayResponses(uploader, upload.responses) };
}

/** Hängt die fehlenden myTT Requests an eine Objekt Antwort. Alles andere bleibt unverändert. */
export function attachRelayRequests(payload: unknown, misses: RelayRequest[]): unknown {
    if (misses.length === 0 || typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        return payload;
    }

    return { ...(payload as Record<string, unknown>), relay: { requests: misses } };
}
