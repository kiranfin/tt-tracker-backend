import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Welche Datenart (siehe policies.ts) einen Upstream Request ausgelöst hat. Die Services setzen sie beim
 * Laden, damit /debug/status zeigen kann, wofür das Budget verbraucht wird.
 */
const storage = new AsyncLocalStorage<string>();

export function runWithDataKind<T>(kind: string, fn: () => Promise<T>): Promise<T> {
    return storage.run(kind, fn);
}

export function getDataKind(): string | undefined {
    return storage.getStore();
}
