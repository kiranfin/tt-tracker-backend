import { config } from "../config.js";
import { writeJsonLog } from "../fileLogger.js";
import { loadCacheFromFile, saveCacheToFile } from "./persistence.js";
import { ResilientCache, type ReadThroughParams } from "./resilientCache.js";
import type { ReadThroughResult } from "./types.js";

export { markLoadOrigin } from "./loadOrigin.js";
export type { CacheSource, ReadThroughResult } from "./types.js";

const { persist, ...cacheOptions } = config.cache;

const cache = new ResilientCache({
    ...cacheOptions,
    onRefreshFailed: ({ key, error }) => {
        void writeJsonLog("cache_refresh_failed", {
            key,
            errorName: error instanceof Error ? error.name : "UnknownError",
            errorMessage: error instanceof Error ? error.message : "Unknown error"
        });
    },
    onStaleServed: ({ key, ageMs, error }) => {
        void writeJsonLog("cache_stale_served", {
            key,
            ageSeconds: Math.round(ageMs / 1000),
            errorName: error instanceof Error ? error.name : "UnknownError",
            errorMessage: error instanceof Error ? error.message : "Unknown error"
        });
    }
});

export function readThrough<T>(params: ReadThroughParams<T>): Promise<ReadThroughResult<T>> {
    return cache.readThrough(params);
}

/** Frischer Wert oder undefined, ohne zu laden. */
export function peekCached<T>(key: string): T | undefined {
    return cache.peek<T>(key);
}

/** Wert, solange er noch brauchbar ist (frisch oder abgelaufen), ohne zu laden. */
export function peekUsableCached<T>(key: string): T | undefined {
    return cache.peekUsable<T>(key);
}

/** Legt einen Wert direkt ab (Merkzettel, die als Nebenprodukt eines Loads entstehen). */
export function putCached(key: string, value: unknown, ttlMs: number, staleMaxMs?: number) {
    cache.set(key, value, ttlMs, "upstream", staleMaxMs);
}

/** Alter und Ablauf aller Einträge, ohne die Werte (für /debug/status). */
export function getCacheEntries() {
    return cache.snapshot().map(([key, entry]) => ({
        key,
        fetchedAt: entry.fetchedAt,
        expiresAt: entry.expiresAt,
        usableUntil: entry.usableUntil
    }));
}

export function getCachedValues(): unknown[] {
    return cache.usableValues();
}

export function getCacheStatus() {
    return {
        ...cache.status(),
        persist: {
            enabled: persist.enabled,
            file: persist.file
        }
    };
}

/** Lädt den gesicherten Cache und sichert ihn danach regelmäßig. */
export async function initCachePersistence() {
    if (!persist.enabled) {
        return;
    }

    try {
        await loadCacheFromFile(cache, persist.file);
    } catch (error) {
        console.warn("Could not load persisted cache", error);
    }

    setInterval(() => void flushCacheToDisk(), persist.intervalMs).unref();
}

/** Sichert den Cache sofort, z.B. beim Beenden. */
export async function flushCacheToDisk() {
    if (!persist.enabled) {
        return;
    }

    try {
        await saveCacheToFile(cache, persist.file);
    } catch (error) {
        console.error("Could not persist cache", error);
    }
}
