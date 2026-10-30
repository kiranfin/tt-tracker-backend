import { CACHE_TTL } from "../constants.js";
import type { MeetingLiveResponse } from "../schemas.js";

export function getMeetingTtlMs(result: MeetingLiveResponse) {
    if (result.data?.live === true) {
        return CACHE_TTL.MEETING_LIVE;
    }

    return result.data?.is_completed === true
        ? CACHE_TTL.MEETING_COMPLETED
        : CACHE_TTL.MEETING_PLANNED;
}
