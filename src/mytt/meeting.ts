import { MeetingLiveResponseSchema } from "../schemas.js";
import type { MeetingLiveResponse } from "../schemas.js";
import { getJsonFromMytt } from "./request.js";

export async function getMeetingLive(params: {
    meetingId: string;
}): Promise<MeetingLiveResponse> {
    return getJsonFromMytt({
        path: `/api/meeting/${encodeURIComponent(params.meetingId)}/live`,
        schema: MeetingLiveResponseSchema
    });
}
