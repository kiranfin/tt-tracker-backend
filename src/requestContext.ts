import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
    requestId: string;
    method: string;
    url: string;
    ip: string;
    userAgent?: string;
    appUserId?: string | null;
};

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getRequestContext() {
    return requestContext.getStore();
}