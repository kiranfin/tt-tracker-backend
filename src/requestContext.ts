import { AsyncLocalStorage } from "node:async_hooks";
import type { RelayContext } from "./relayTypes.js";

export type RequestContext = {
    requestId: string;
    method: string;
    url: string;
    ip: string;
    userAgent?: string;
    appUserId?: string | null;
    // Gesetzt, wenn die App den Header `x-tt-relay: 1` sendet (Device Relay).
    relay?: RelayContext;
};

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getRequestContext() {
    return requestContext.getStore();
}
