/** Woher ein frisch geladener Wert stammt. "html" heißt: JSON API ausgefallen, Webseite eingesprungen. */
export type LoadOrigin = "upstream" | "html";

/** Woher eine Antwort kam. "stale" ist ein abgelaufener Eintrag, der einen Fehler abfängt. */
export type CacheSource = "cache" | LoadOrigin | "stale";

export type CacheEntry = {
    value: unknown;
    fetchedAt: number;
    expiresAt: number;
    // Bis dahin taugt der Eintrag als Notnagel und für stale-while-revalidate. Fehlt es (ältere
    // gesicherte Einträge), gilt fetchedAt plus die globale Obergrenze.
    usableUntil?: number;
    origin: LoadOrigin;
    // Nach einem fehlgeschlagenen Load wird die kaputte Quelle bis dahin nicht erneut belastet.
    retryAt?: number;
};

export type ReadThroughResult<T> = {
    value: T;
    source: CacheSource;
    // Woher der Wert ursprünglich geladen wurde, auch bei Cache Treffern und stale Antworten.
    origin: LoadOrigin;
    fetchedAt: string;
};

/** Feste Dauer oder abhängig vom geladenen Wert (z.B. Live Spiele kürzer). */
export type CacheTtl<T> = number | ((value: T) => number);
