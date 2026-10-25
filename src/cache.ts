import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { readBooleanEnv, readNumberEnv } from "./config.js";
import { writeJsonLog } from "./fileLogger.js";

export type LoadOrigin = "upstream" | "html";
export type CacheSource = "cache" | "upstream" | "html" | "stale";

type CacheEntry = {
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

const MAX_ENTRIES = readNumberEnv("CACHE_MAX_ENTRIES", 2000, { min: 1 });
const STALE_MAX_AGE_MS = readNumberEnv("CACHE_STALE_MAX_AGE_MS", 7 * 24 * 60 * 60 * 1000, {
    min: 0
});
const FAILED_LOAD_RETRY_MS = readNumberEnv("CACHE_FAILED_LOAD_RETRY_MS", 30 * 1000, {
    min: 0
});
const PERSIST_ENABLED = readBooleanEnv("CACHE_PERSIST_ENABLED", true);
const PERSIST_FILE = resolve(process.env.CACHE_PERSIST_FILE ?? "data/cache.json");
const PERSIST_INTERVAL_MS = 5 * 60 * 1000;

const store = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<LoadedValue>>();
const loadContext = new AsyncLocalStorage<{ origin: LoadOrigin }>();

type LoadedValue = {
    value: unknown;
    fetchedAt: number;
    origin: LoadOrigin;
};

const stats = {
    hits: 0,
    misses: 0,
    staleServed: 0,
    deduped: 0,
    loadFailures: 0
};

let dirty = false;

/**
 * Wird von einer Quelle aufgerufen, wenn der Wert nicht aus dem Standardweg stammt
 * (z.B. HTML Fallback statt JSON API). Wirkt auf den gerade laufenden readThrough Load.
 */
export function markLoadOrigin(origin: LoadOrigin): void {
    const context = loadContext.getStore();

    if (context) {
        context.origin = origin;
    }
}

function isUsableStale(entry: CacheEntry, now: number): boolean {
    return now - entry.fetchedAt <= STALE_MAX_AGE_MS;
}

function evictIfNeeded(now: number): void {
    if (store.size <= MAX_ENTRIES) {
        return;
    }

    for (const [key, entry] of store) {
        if (!isUsableStale(entry, now)) {
            store.delete(key);
        }
    }

    // Map behält die Einfügereihenfolge, die ältesten Einträge stehen vorne.
    for (const key of store.keys()) {
        if (store.size <= MAX_ENTRIES) {
            break;
        }

        store.delete(key);
    }
}

export function setCache<T>(
    key: string,
    value: T,
    ttlMs: number,
    origin: LoadOrigin = "upstream"
): void {
    const now = Date.now();

    store.delete(key);
    store.set(key, {
        value,
        fetchedAt: now,
        expiresAt: now + ttlMs,
        origin
    });

    dirty = true;
    evictIfNeeded(now);
}

export function getFromCache<T>(key: string): T | null {
    const entry = store.get(key);

    if (!entry || Date.now() > entry.expiresAt) {
        return null;
    }

    return entry.value as T;
}

function toResult<T>(
    value: unknown,
    source: CacheSource,
    fetchedAt: number
): ReadThroughResult<T> {
    return {
        value: value as T,
        source,
        fetchedAt: new Date(fetchedAt).toISOString()
    };
}

export type CacheTtl<T> = number | ((value: T) => number);

function runLoad(
    key: string,
    ttl: CacheTtl<never>,
    load: () => Promise<unknown>
): Promise<LoadedValue> {
    const promise = loadContext.run({ origin: "upstream" }, async () => {
        const context = loadContext.getStore();
        const value = await load();
        const origin = context?.origin ?? "upstream";
        const fetchedAt = Date.now();

        const ttlMs =
            typeof ttl === "function" ? (ttl as (v: unknown) => number)(value) : ttl;

        setCache(key, value, ttlMs, origin);

        return { value, fetchedAt, origin };
    });

    inFlight.set(key, promise);

    const cleanup = () => {
        if (inFlight.get(key) === promise) {
            inFlight.delete(key);
        }
    };

    promise.then(cleanup, cleanup);

    return promise;
}

/**
 * Liefert frische Daten aus dem Cache, sonst load(). Gleichzeitige Aufrufe für denselben Key
 * teilen sich einen Load. Schlägt load() fehl und es gibt einen abgelaufenen Eintrag,
 * wird dieser als "stale" ausgeliefert statt den Fehler weiterzugeben.
 */
export async function readThrough<T>(params: {
    key: string;
    ttlMs: CacheTtl<T>;
    load: () => Promise<T>;
}): Promise<ReadThroughResult<T>> {
    const now = Date.now();
    const entry = store.get(params.key);

    if (entry && now <= entry.expiresAt) {
        stats.hits += 1;
        return toResult<T>(entry.value, "cache", entry.fetchedAt);
    }

    const staleEntry = entry && isUsableStale(entry, now) ? entry : undefined;

    if (staleEntry?.retryAt && now < staleEntry.retryAt) {
        stats.staleServed += 1;
        return toResult<T>(staleEntry.value, "stale", staleEntry.fetchedAt);
    }

    stats.misses += 1;

    let pending = inFlight.get(params.key);

    if (pending) {
        stats.deduped += 1;
    } else {
        pending = runLoad(params.key, params.ttlMs as CacheTtl<never>, params.load);
    }

    try {
        const loaded = await pending;
        return toResult<T>(loaded.value, loaded.origin, loaded.fetchedAt);
    } catch (error) {
        stats.loadFailures += 1;

        const current = store.get(params.key);

        if (current && isUsableStale(current, Date.now())) {
            current.retryAt = Date.now() + FAILED_LOAD_RETRY_MS;
            stats.staleServed += 1;

            void writeJsonLog("cache_stale_served", {
                key: params.key,
                ageSeconds: Math.round((Date.now() - current.fetchedAt) / 1000),
                errorName: error instanceof Error ? error.name : "UnknownError",
                errorMessage: error instanceof Error ? error.message : "Unknown error"
            });

            return toResult<T>(current.value, "stale", current.fetchedAt);
        }

        throw error;
    }
}

export function getCacheStatus() {
    const now = Date.now();
    let fresh = 0;
    let stale = 0;

    for (const entry of store.values()) {
        if (now <= entry.expiresAt) {
            fresh += 1;
        } else {
            stale += 1;
        }
    }

    return {
        entries: store.size,
        fresh,
        stale,
        maxEntries: MAX_ENTRIES,
        staleMaxAgeMs: STALE_MAX_AGE_MS,
        inFlight: inFlight.size,
        persist: {
            enabled: PERSIST_ENABLED,
            file: PERSIST_FILE
        },
        ...stats
    };
}

type PersistedCache = {
    version: 1;
    savedAt: string;
    entries: Array<[string, CacheEntry]>;
};

export async function flushCacheToDisk(): Promise<void> {
    if (!PERSIST_ENABLED || !dirty) {
        return;
    }

    try {
        const payload: PersistedCache = {
            version: 1,
            savedAt: new Date().toISOString(),
            entries: [...store.entries()]
        };

        await mkdir(dirname(PERSIST_FILE), { recursive: true });

        const tempFile = `${PERSIST_FILE}.tmp`;
        await writeFile(tempFile, JSON.stringify(payload), "utf8");
        await rename(tempFile, PERSIST_FILE);

        dirty = false;
    } catch (error) {
        console.error("Could not persist cache", error);
    }
}

async function loadCacheFromDisk(): Promise<void> {
    try {
        const raw = await readFile(PERSIST_FILE, "utf8");
        const parsed = JSON.parse(raw) as Partial<PersistedCache>;

        if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
            return;
        }

        const now = Date.now();

        for (const [key, entry] of parsed.entries) {
            if (
                typeof key === "string" &&
                entry &&
                typeof entry.fetchedAt === "number" &&
                typeof entry.expiresAt === "number" &&
                isUsableStale(entry, now) &&
                !store.has(key)
            ) {
                store.set(key, {
                    value: entry.value,
                    fetchedAt: entry.fetchedAt,
                    expiresAt: entry.expiresAt,
                    origin: entry.origin === "html" ? "html" : "upstream"
                });
            }
        }

        evictIfNeeded(now);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            console.warn("Could not load persisted cache", error);
        }
    }
}

/**
 * Lädt den Cache von der Platte und schreibt ihn danach regelmäßig zurück.
 * Das Schreiben beim Shutdown übernimmt der Aufrufer über flushCacheToDisk().
 */
export async function initCachePersistence(): Promise<void> {
    if (!PERSIST_ENABLED) {
        return;
    }

    await loadCacheFromDisk();

    const timer = setInterval(() => {
        void flushCacheToDisk();
    }, PERSIST_INTERVAL_MS);

    timer.unref();
}
