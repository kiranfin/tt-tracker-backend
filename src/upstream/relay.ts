import { config } from "../config.js";
import { writeJsonLog } from "../fileLogger.js";
import { getRequestContext } from "../requestContext.js";
import type { RelayContext, RelayRequest, RelayResponse } from "../relayTypes.js";
import { RelayRequiredError } from "./errors.js";
import type { UpstreamRequest, UpstreamTextResponse } from "./fetch.js";
import { getUpstreamPriority } from "./priority.js";

/*
 * Device Relay: Statt selbst bei myTischtennis anzufragen, meldet das Backend der App den fehlenden
 * Request. Die App holt ihn von ihrer eigenen IP und lädt die Rohantwort hoch. Danach läuft der
 * Load erneut und liest die Antwort hier aus der Inbox. Parser, Schemas und Validierung bleiben
 * unverändert, nur fetchUpstreamText wird umgangen.
 */

const WINDOW_MS = 30 * 60 * 1000;

type StoredRelayResponse = Pick<RelayResponse, "status" | "contentType" | "body" | "finalUrl" | "remixError">;

// Ticket: das Backend hat diesem Uploader den Request gemeldet. Nur dafür darf hochgeladen werden.
const tickets = new Map<string, number>();
const inbox = new Map<string, { response: StoredRelayResponse; expiresAt: number }>();
const uploadsByUploader = new Map<string, number[]>();

const counters = { served: 0, misses: 0, uploadsAccepted: 0, uploadsRejected: 0, uploadsDuplicate: 0 };

function entryKey(uploader: string, id: string) {
    return `${uploader}|${id}`;
}

/** Eindeutige Kennung eines myTT Requests: Methode, Pfad, sortierte Query und ggf. Body. */
export function relayFingerprint(request: UpstreamRequest): string {
    const query = new URLSearchParams([...request.url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b)));
    const queryText = query.toString();
    const body = request.body?.toString();

    return `${request.method} ${request.path}?${queryText}${body ? `#${body}` : ""}`;
}

function hasCookie(headers: Record<string, string>) {
    return Object.keys(headers).some((name) => name.toLowerCase() === "cookie");
}

function toRelayRequest(request: UpstreamRequest): RelayRequest {
    const headers: Record<string, string> = {};

    for (const [name, value] of Object.entries(request.headers)) {
        const lower = name.toLowerCase();

        if (lower !== "cookie" && lower !== "authorization") {
            headers[lower] = value;
        }
    }

    const body = request.body?.toString();

    return {
        id: relayFingerprint(request),
        method: request.method,
        url: request.url.toString(),
        headers,
        ...(body ? { body } : {})
    };
}

function prune(now: number) {
    for (const [key, expiresAt] of tickets) {
        if (expiresAt <= now) {
            tickets.delete(key);
        }
    }

    for (const [key, entry] of inbox) {
        if (entry.expiresAt <= now) {
            inbox.delete(key);
        }
    }

    // Älteste zuerst (Map Reihenfolge ist Einfügereihenfolge).
    while (tickets.size + inbox.size > config.relay.maxEntries) {
        const source = inbox.size >= tickets.size ? inbox : tickets;
        const oldest = source.keys().next().value;

        if (oldest === undefined) {
            break;
        }

        source.delete(oldest);
    }
}

/** Relay Zustand des laufenden Requests, nur wenn er für interaktive Arbeit gilt. */
export function getRelayState(): RelayContext | undefined {
    if (!config.relay.enabled || getUpstreamPriority() !== "interactive") {
        return undefined;
    }

    return getRequestContext()?.relay;
}

export function isRelayActive(request: UpstreamRequest): boolean {
    return getRelayState() !== undefined && !hasCookie(request.headers);
}

function toSyntheticResponse(request: UpstreamRequest, stored: StoredRelayResponse): UpstreamTextResponse {
    const headers = new Headers();

    if (stored.contentType) {
        headers.set("content-type", stored.contentType);
    }

    if (stored.remixError) {
        headers.set("x-remix-error", "1");
    }

    // 204, 205 und 304 dürfen keinen Body haben, sonst wirft der Response Konstruktor.
    const noBody = stored.status === 204 || stored.status === 205 || stored.status === 304;
    const response = new Response(noBody ? null : stored.body, { status: stored.status, headers });

    return {
        response,
        bodyText: noBody ? "" : stored.body,
        finalUrl: stored.finalUrl || request.url.toString()
    };
}

/**
 * Liefert die hochgeladene Antwort aus der Inbox. Fehlt sie, merkt sich der Request die Anfrage
 * (für die App) und wirft RelayRequiredError. Null heißt: Relay gilt hier nicht, normal weitermachen.
 */
export function tryRelay(request: UpstreamRequest): UpstreamTextResponse | null {
    const relay = getRelayState();

    if (!relay || hasCookie(request.headers)) {
        return null;
    }

    const now = Date.now();
    const id = relayFingerprint(request);
    const key = entryKey(relay.uploader, id);

    prune(now);

    const hit = inbox.get(key);

    if (hit) {
        relay.served += 1;
        counters.served += 1;

        return toSyntheticResponse(request, hit.response);
    }

    if (!relay.misses.some((miss) => miss.id === id)) {
        relay.misses.push(toRelayRequest(request));
        counters.misses += 1;
    }

    tickets.delete(key);
    tickets.set(key, now + config.relay.inboxTtlMs);

    throw new RelayRequiredError();
}

function rejectReason(response: RelayResponse): string | null {
    if (response.status === 429) {
        return "status_429";
    }

    if (response.status < 200 || response.status > 599) {
        return "status_out_of_range";
    }

    if (Buffer.byteLength(response.body, "utf8") > config.relay.maxBodyBytes) {
        return "body_too_large";
    }

    let final: URL;
    let base: URL;

    try {
        final = new URL(response.finalUrl);
        base = new URL(config.upstream.baseUrl);
    } catch {
        return "final_url_invalid";
    }

    if (final.origin !== base.origin) {
        return "final_url_other_origin";
    }

    if (final.pathname === "/verify" || final.pathname.startsWith("/verify/")) {
        return "final_url_verify";
    }

    return null;
}

/**
 * Legt hochgeladene Antworten in die Inbox. Abgelehnte werden übersprungen (nicht geworfen).
 * Gibt die Anzahl akzeptierter Antworten zurück.
 */
export function storeRelayResponses(uploader: string, responses: RelayResponse[]): number {
    const now = Date.now();
    let accepted = 0;

    prune(now);

    for (const response of responses) {
        const key = entryKey(uploader, response.id);

        // Zwei Requests desselben Geräts haben denselben Miss gemeldet, der erste Upload hat das Ticket schon
        // verbraucht. Die Antwort liegt bereits in der Inbox: als angenommen zählen, aber nichts überschreiben.
        // Sonst fiele der zweite Request auf den Server zurück und die Server IP zahlte doch.
        if (!tickets.has(key) && inbox.has(key)) {
            void writeJsonLog("mytt_relay_upload", {
                uploader,
                id: response.id,
                status: response.status,
                bytes: Buffer.byteLength(response.body, "utf8"),
                accepted: true,
                reason: "duplicate"
            });

            counters.uploadsDuplicate += 1;
            accepted += 1;
            continue;
        }

        const reason = tickets.has(key) ? rejectReason(response) : "no_ticket";

        void writeJsonLog("mytt_relay_upload", {
            uploader,
            id: response.id,
            status: response.status,
            bytes: Buffer.byteLength(response.body, "utf8"),
            accepted: reason === null,
            reason: reason ?? undefined
        });

        if (reason) {
            counters.uploadsRejected += 1;
            continue;
        }

        // Ein Ticket gilt für genau einen Upload.
        tickets.delete(key);
        inbox.delete(key);
        inbox.set(key, {
            response: {
                status: response.status,
                contentType: response.contentType,
                body: response.body,
                finalUrl: response.finalUrl,
                remixError: response.remixError
            },
            expiresAt: now + config.relay.inboxTtlMs
        });

        counters.uploadsAccepted += 1;
        accepted += 1;
    }

    prune(now);

    return accepted;
}

/** Rollendes 30 Minuten Fenster pro Uploader. Zählt Antworten, nicht Uploads. */
export function allowRelayUpload(uploader: string, count = 1): boolean {
    const now = Date.now();
    const windowStart = now - WINDOW_MS;
    const recent = (uploadsByUploader.get(uploader) ?? []).filter((timestamp) => timestamp > windowStart);

    if (recent.length + count > config.relay.uploadsPer30Min) {
        uploadsByUploader.set(uploader, recent);

        return false;
    }

    for (let index = 0; index < count; index += 1) {
        recent.push(now);
    }

    uploadsByUploader.set(uploader, recent);

    return true;
}

export function getRelayStatus() {
    prune(Date.now());

    return {
        enabled: config.relay.enabled,
        requireAuth: config.relay.requireAuth,
        ...counters,
        inboxEntries: inbox.size,
        tickets: tickets.size
    };
}

export function resetRelayForTests() {
    tickets.clear();
    inbox.clear();
    uploadsByUploader.clear();
    counters.served = 0;
    counters.misses = 0;
    counters.uploadsAccepted = 0;
    counters.uploadsRejected = 0;
    counters.uploadsDuplicate = 0;
}
