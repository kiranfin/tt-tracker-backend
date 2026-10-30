export function normalizeNuid(nuid: string) {
    return nuid.trim().toUpperCase();
}

/** myTischtennis erwartet für Head to Head die ID ohne NU Präfix. */
export function toHeadToHeadOtherUser(nuid: string) {
    const normalized = normalizeNuid(nuid);

    if (normalized.startsWith("NU")) {
        return normalized.slice(2);
    }

    return normalized;
}
