import { runWithLoadOrigin } from "./loadOrigin.js";
import type {
    CacheEntry,
    CacheTtl,
    LoadOrigin,
    ReadThroughResult
} from "./types.js";

export type ResilientCacheOptions = {
    maxEntries: number;
    staleMaxAgeMs: number;
    failedLoadRetryMs: number;
    now?: () => number;
    onStaleServed?: (info: { key: string; ageMs: number; error: unknown }) => void;
};

type LoadedValue = {
    value: unknown;
    fetchedAt: number;
    origin: LoadOrigin;
};

/**
 * In-Memory Cache, der Daten auch nach Ablauf der TTL noch ausliefern kann:
 * - frische Einträge kommen sofort zurück,
 * - gleichzeitige Loads für denselben Key teilen sich ein Promise,
 * - schlägt der Load fehl und es gibt einen abgelaufenen Eintrag, wird der als "stale" geliefert.
 */
export class ResilientCache {
    private readonly entries = new Map<string, CacheEntry>();
    private readonly inFlight = new Map<string, Promise<LoadedValue>>();
    private readonly now: () => number;
    private unsavedChanges = false;

    private readonly counters = {
        hits: 0,
        misses: 0,
        staleServed: 0,
        deduped: 0,
        loadFailures: 0
    };

    constructor(private readonly options: ResilientCacheOptions) {
        this.now = options.now ?? Date.now;
    }

    set(key: string, value: unknown, ttlMs: number, origin: LoadOrigin = "upstream") {
        const now = this.now();

        // Neu einfügen, damit die Map-Reihenfolge dem Alter entspricht (älteste zuerst).
        this.entries.delete(key);
        this.entries.set(key, {
            value,
            fetchedAt: now,
            expiresAt: now + ttlMs,
            origin
        });

        this.unsavedChanges = true;
        this.evict();
    }

    async readThrough<T>(params: {
        key: string;
        ttlMs: CacheTtl<T>;
        load: () => Promise<T>;
    }): Promise<ReadThroughResult<T>> {
        const { key } = params;
        const now = this.now();
        const entry = this.entries.get(key);

        if (entry && now <= entry.expiresAt) {
            this.counters.hits += 1;
            return this.toResult<T>(entry.value, "cache", entry.origin, entry.fetchedAt);
        }

        const stale = entry && this.isUsableStale(entry) ? entry : undefined;

        if (stale?.retryAt && now < stale.retryAt) {
            this.counters.staleServed += 1;
            return this.toResult<T>(stale.value, "stale", stale.origin, stale.fetchedAt);
        }

        this.counters.misses += 1;

        try {
            const loaded = await this.loadShared(params);
            return this.toResult<T>(loaded.value, loaded.origin, loaded.origin, loaded.fetchedAt);
        } catch (error) {
            this.counters.loadFailures += 1;

            const fallback = this.entries.get(key);

            if (!fallback || !this.isUsableStale(fallback)) {
                throw error;
            }

            fallback.retryAt = this.now() + this.options.failedLoadRetryMs;
            this.counters.staleServed += 1;

            this.options.onStaleServed?.({
                key,
                ageMs: this.now() - fallback.fetchedAt,
                error
            });

            return this.toResult<T>(fallback.value, "stale", fallback.origin, fallback.fetchedAt);
        }
    }

    status() {
        const now = this.now();
        let fresh = 0;

        for (const entry of this.entries.values()) {
            if (now <= entry.expiresAt) {
                fresh += 1;
            }
        }

        return {
            entries: this.entries.size,
            fresh,
            stale: this.entries.size - fresh,
            maxEntries: this.options.maxEntries,
            staleMaxAgeMs: this.options.staleMaxAgeMs,
            inFlight: this.inFlight.size,
            ...this.counters
        };
    }

    get hasUnsavedChanges() {
        return this.unsavedChanges;
    }

    snapshot(): Array<[string, CacheEntry]> {
        return [...this.entries.entries()];
    }

    markSaved() {
        this.unsavedChanges = false;
    }

    /** Übernimmt gespeicherte Einträge, soweit sie noch als Notnagel taugen. Bestehende bleiben. */
    restore(entries: Array<[string, CacheEntry]>) {
        for (const [key, entry] of entries) {
            if (!this.entries.has(key) && this.isUsableStale(entry)) {
                this.entries.set(key, { ...entry, retryAt: undefined });
            }
        }

        this.evict();
    }

    private loadShared<T>(params: {
        key: string;
        ttlMs: CacheTtl<T>;
        load: () => Promise<T>;
    }): Promise<LoadedValue> {
        const running = this.inFlight.get(params.key);

        if (running) {
            this.counters.deduped += 1;
            return running;
        }

        const promise = this.loadAndStore(params);
        const clear = () => {
            this.inFlight.delete(params.key);
        };

        this.inFlight.set(params.key, promise);
        promise.then(clear, clear);

        return promise;
    }

    private async loadAndStore<T>(params: {
        key: string;
        ttlMs: CacheTtl<T>;
        load: () => Promise<T>;
    }): Promise<LoadedValue> {
        const { value, origin } = await runWithLoadOrigin(params.load);
        const ttlMs =
            typeof params.ttlMs === "function" ? params.ttlMs(value) : params.ttlMs;

        this.set(params.key, value, ttlMs, origin);

        return { value, origin, fetchedAt: this.now() };
    }

    private isUsableStale(entry: CacheEntry) {
        return this.now() - entry.fetchedAt <= this.options.staleMaxAgeMs;
    }

    private evict() {
        if (this.entries.size <= this.options.maxEntries) {
            return;
        }

        for (const [key, entry] of this.entries) {
            if (!this.isUsableStale(entry)) {
                this.entries.delete(key);
            }
        }

        for (const key of this.entries.keys()) {
            if (this.entries.size <= this.options.maxEntries) {
                break;
            }

            this.entries.delete(key);
        }
    }

    private toResult<T>(
        value: unknown,
        source: ReadThroughResult<T>["source"],
        origin: LoadOrigin,
        fetchedAt: number
    ): ReadThroughResult<T> {
        return {
            value: value as T,
            source,
            origin,
            fetchedAt: new Date(fetchedAt).toISOString()
        };
    }
}
