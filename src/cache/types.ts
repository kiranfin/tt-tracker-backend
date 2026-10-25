/** Woher ein frisch geladener Wert stammt. "html" heißt: JSON API ausgefallen, Webseite eingesprungen. */
export type LoadOrigin = "upstream" | "html";

/** Woher eine Antwort kam. "stale" ist ein abgelaufener Eintrag, der einen Fehler abfängt. */
export type CacheSource = "cache" | LoadOrigin | "stale";

export type CacheEntry = {
    value: unknown;
    fetchedAt: number;
    expiresAt: number;
    origin: LoadOrigin;
    // Nach einem fehlgeschlagenen Load wird die kaputte Quelle bis dahin nicht erneut belastet.
    retryAt?: number;
};

export type ReadThroughResult<T> = {
    value: T;
    source: CacheSource;
    fetchedAt: string;
};

/** Feste Dauer oder abhängig vom geladenen Wert (z.B. Live Spiele kürzer). */
export type CacheTtl<T> = number | ((value: T) => number);
