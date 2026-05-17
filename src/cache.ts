type CacheEntry<T> = {
    value: T;
    expiresAt: number;
};

const cache = new Map<string, CacheEntry<unknown>>();

export function getFromCache<T>(key: string): T | null {
    const entry = cache.get(key);

    if (!entry) {
        return null;
    }

    if (Date.now() > entry.expiresAt) {
        cache.delete(key);
        return null;
    }

    return entry.value as T;
}

export function setCache<T>(key: string, value: T, ttlMs: number): void {
    cache.set(key, {
        value,
        expiresAt: Date.now() + ttlMs
    });
}