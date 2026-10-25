import { config } from "../config.js";
import { CircuitBreaker, type UpstreamResult } from "./circuitBreaker.js";
import { LocalRateLimitError } from "./errors.js";
import { RequestWindow } from "./requestWindow.js";
import { Throttle, type Release } from "./throttle.js";

const breaker = new CircuitBreaker({
    ...config.breaker,
    onOpen: (reason, pauseMs) => {
        console.warn(
            `myTischtennis circuit breaker opened (${reason}) for ${Math.round(pauseMs / 1000)}s`
        );
    }
});

const requestWindow = new RequestWindow(config.maxRequestsPerHour);

function assertBreakerClosed() {
    const remainingMs = breaker.remainingMs();

    if (remainingMs > 0) {
        throw new LocalRateLimitError(remainingMs, "breaker_open");
    }
}

const throttle = new Throttle({
    ...config.throttle,
    guard: assertBreakerClosed
});

/**
 * Wartet auf einen freien Upstream Slot und liefert die release Funktion, die nach dem Request
 * aufgerufen werden muss. Abgelehnt wird nur, wenn der Breaker offen ist, die Notbremse
 * greift oder die Warteschlange voll ist.
 *
 * counted=false (z.B. /api/ttr/*) umgeht Warteschlange, Notbremse und Breaker Sperre.
 */
export async function acquireUpstreamSlot(options?: {
    counted?: boolean;
}): Promise<Release> {
    if (options?.counted === false) {
        return () => {};
    }

    assertBreakerClosed();
    requestWindow.assertAvailable();

    const release = await throttle.acquire();

    requestWindow.record();

    return release;
}

/** Meldet das Ergebnis eines Upstream Calls an den Breaker (auch für nicht gezählte Calls). */
export function reportUpstreamResult(result: UpstreamResult) {
    breaker.report(result);
}

export function getRateLimitStatus() {
    return {
        ...requestWindow.status(),
        queue: throttle.status(),
        breaker: breaker.status()
    };
}
