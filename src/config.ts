export function readNumberEnv(
    key: string,
    fallback: number,
    options?: { min?: number }
): number {
    const raw = process.env[key];

    if (!raw || raw.trim() === "") {
        return fallback;
    }

    const parsed = Number(raw);
    const min = options?.min ?? 0;

    if (!Number.isFinite(parsed) || parsed < min) {
        console.warn(`Invalid ${key}="${raw}", falling back to ${fallback}`);
        return fallback;
    }

    return parsed;
}

export function readBooleanEnv(key: string, fallback: boolean): boolean {
    const raw = process.env[key]?.trim().toLowerCase();

    if (!raw) {
        return fallback;
    }

    if (raw === "true" || raw === "1") {
        return true;
    }

    if (raw === "false" || raw === "0") {
        return false;
    }

    return fallback;
}
