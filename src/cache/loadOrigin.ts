import { AsyncLocalStorage } from "node:async_hooks";
import type { LoadOrigin } from "./types.js";

const currentLoad = new AsyncLocalStorage<{ origin: LoadOrigin }>();

/**
 * Führt einen Load aus und gibt zusätzlich zurück, ob er über einen Ausweichweg lief.
 * So muss der Fallback Code nicht durch jede Client Funktion bis zum Cache gereicht werden.
 */
export async function runWithLoadOrigin<T>(
    load: () => Promise<T>
): Promise<{ value: T; origin: LoadOrigin }> {
    const state: { origin: LoadOrigin } = { origin: "upstream" };
    const value = await currentLoad.run(state, load);

    return { value, origin: state.origin };
}

/** Vermerkt für den gerade laufenden Load, dass der Wert nicht vom Standardweg stammt. */
export function markLoadOrigin(origin: LoadOrigin) {
    const state = currentLoad.getStore();

    if (state) {
        state.origin = origin;
    }
}
