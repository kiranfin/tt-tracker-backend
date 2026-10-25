import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ResilientCache } from "./resilientCache.js";
import type { CacheEntry } from "./types.js";

type PersistedCache = {
    version: 1;
    savedAt: string;
    entries: Array<[string, CacheEntry]>;
};

export async function saveCacheToFile(cache: ResilientCache, file: string): Promise<void> {
    if (!cache.hasUnsavedChanges) {
        return;
    }

    const payload: PersistedCache = {
        version: 1,
        savedAt: new Date().toISOString(),
        entries: cache.snapshot()
    };

    await mkdir(dirname(file), { recursive: true });

    // Erst in eine Temp Datei schreiben, damit ein Abbruch die alte Datei nicht zerstört.
    const tempFile = `${file}.tmp`;
    await writeFile(tempFile, JSON.stringify(payload), "utf8");
    await rename(tempFile, file);

    cache.markSaved();
}

export async function loadCacheFromFile(cache: ResilientCache, file: string): Promise<void> {
    let raw: string;

    try {
        raw = await readFile(file, "utf8");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return;
        }

        throw error;
    }

    const parsed = JSON.parse(raw) as Partial<PersistedCache>;

    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
        return;
    }

    cache.restore(
        parsed.entries.filter(
            ([key, entry]) =>
                typeof key === "string" &&
                typeof entry?.fetchedAt === "number" &&
                typeof entry.expiresAt === "number"
        )
    );
}
