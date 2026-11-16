// Typ-only: shared between requestContext, upstream/relay and services/relay without import cycles.

/** Request, den das Backend der App zum Abruf bei myTischtennis beschreibt. */
export type RelayRequest = {
    // Fingerprint, siehe relayFingerprint in upstream/relay.ts.
    id: string;
    method: "GET" | "POST";
    // Absolut, immer config.upstream.baseUrl + Pfad + Query.
    url: string;
    // Header, die das Backend selbst senden würde, ohne cookie.
    headers: Record<string, string>;
    // form-encoded, nur bei POST.
    body?: string;
};

/** Rohantwort von myTischtennis, die die App hochlädt. */
export type RelayResponse = {
    id: string;
    status: number;
    contentType: string;
    body: string;
    finalUrl: string;
    remixError?: boolean;
};

/** Zustand des Relays für genau einen Backend Request. */
export type RelayContext = {
    // "user:<id>" oder "ip:<ip>"
    uploader: string;
    // In diesem Request fehlende myTT Antworten (ohne Duplikate).
    misses: RelayRequest[];
    // Aus der Inbox bediente Requests.
    served: number;
};
