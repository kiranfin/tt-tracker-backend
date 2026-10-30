import { cacheKeys } from "../cacheKeys.js";
import { getMeetingLive } from "../mytt/meeting.js";
import { getFreshMs } from "../policies.js";
import type { MeetingLiveResponse } from "../schemas.js";
import { getStoredMeeting, storeMeeting } from "../store/meetingStore.js";
import { readByPolicy, type ServiceResult } from "./read.js";

/**
 * Spielbericht über Ablage und Cache. Die Meeting Route und die TTR Schätzung teilen sich den Eintrag.
 * Ein abgeschlossener Bericht liegt dauerhaft in der Ablage und wird nie wieder bei myTischtennis
 * angefragt.
 */
export async function getMeeting(meetingId: string): Promise<ServiceResult<MeetingLiveResponse>> {
    const stored = getStoredMeeting(meetingId);

    if (stored) {
        return {
            value: stored.value,
            meta: {
                source: "cache",
                origin: "upstream",
                fetchedAt: new Date(stored.fetchedAt).toISOString(),
                cacheTtlMs: getFreshMs("MEETING", stored.value)
            }
        };
    }

    return readByPolicy({
        kind: "MEETING",
        key: cacheKeys.meetingLive(meetingId),
        load: async () => {
            const response = await getMeetingLive({ meetingId });

            storeMeeting(meetingId, response);

            return response;
        },
        extraMeta: (value) => ({ cacheTtlMs: getFreshMs("MEETING", value) })
    });
}
