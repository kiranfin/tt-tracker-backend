import { MeetingLiveResponseSchema } from "../schemas.js";
import type { MeetingLiveResponse } from "../schemas.js";
import { fetchWithFallback } from "../sources/fetchWithFallback.js";
import {
    buildMeetingReportPagePath,
    meetingReportToApiResponse,
    MEETING_REPORT_ROUTE_ID
} from "../sources/html/meetingReport.js";
import { getRouteDataFromPage } from "../sources/html/pageRoute.js";
import { parseUpstream } from "../upstream/parse.js";
import { getJsonFromMytt } from "./request.js";

/**
 * Spielbericht: JSON API zuerst, bei einer API Störung die Spielbericht Seite (eigene Lane, läuft bei einer
 * API Störung weiter). Das Kontingent teilen sich beide, gespart wird nichts, gewonnen wird Ausfallsicherheit.
 */
export async function getMeetingLive(params: {
    meetingId: string;
}): Promise<MeetingLiveResponse> {
    return fetchWithFallback({
        name: "meeting_live",
        primary: () =>
            getJsonFromMytt({
                path: `/api/meeting/${encodeURIComponent(params.meetingId)}/live`,
                schema: MeetingLiveResponseSchema
            }),
        fallback: async () => {
            const { routeData } = await getRouteDataFromPage({
                path: buildMeetingReportPagePath(params.meetingId),
                routeId: MEETING_REPORT_ROUTE_ID
            });

            return parseUpstream(
                MeetingLiveResponseSchema,
                meetingReportToApiResponse(routeData),
                "meeting_live:html"
            );
        }
    });
}
