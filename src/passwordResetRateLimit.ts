// In-memory rate limit for password-reset requests, keyed by normalized email.
// Deliberately silent: callers skip sending (but still answer generically) when
// the limit is hit, so it doubles as abuse protection without leaking which
// emails exist.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 3;

const attemptsByKey = new Map<string, number[]>();

export function allowPasswordResetRequest(key: string): boolean {
    const now = Date.now();
    const windowStart = now - WINDOW_MS;

    const recent = (attemptsByKey.get(key) ?? []).filter(
        (timestamp) => timestamp > windowStart
    );

    if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
        attemptsByKey.set(key, recent);
        return false;
    }

    recent.push(now);
    attemptsByKey.set(key, recent);

    return true;
}
