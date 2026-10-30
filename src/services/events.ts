import { cacheKeys } from "../cacheKeys.js";
import { fetchEventDetail, fetchEventsList } from "../dancingParkClient.js";
import { readByPolicy } from "./read.js";

export function getEventList() {
    return readByPolicy({
        kind: "EVENTS_LIST",
        key: cacheKeys.eventsList(),
        load: () => fetchEventsList()
    });
}

export function getEventDetail(id: string) {
    return readByPolicy({
        kind: "EVENTS_DETAIL",
        key: cacheKeys.eventsDetail(id),
        load: () => fetchEventDetail(id)
    });
}
