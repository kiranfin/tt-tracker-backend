import { RemixContextParseError, type JsonRecord } from "./remixContext.js";

// Route der Spielbericht Seite. Ihr Loader liefert denselben Bericht wie /api/meeting/<id>/live, nur unter
// `meetingReport` statt `data`.
export const MEETING_REPORT_ROUTE_ID =
    "routes/click-tt+/$association+/$season+/$type+/$groupname.gruppe.$urlid+/spielbericht.$meeting_id.$meeting_name";

/**
 * Pfad der Spielbericht Seite nur aus der Meeting ID. Verband, Saison, Liga, Gruppe und Namen werden vom
 * Loader nicht ausgewertet (geprüft mit lauter Platzhaltern), die Route verlangt nur, dass die Segmente da sind.
 * Deshalb braucht der Fallback keinen Kontext, den das Backend bei einer API Störung nicht kennt.
 */
export function buildMeetingReportPagePath(meetingId: string): string {
    return `/click-tt/x/x/ligen/x/gruppe/x/spielbericht/${encodeURIComponent(meetingId)}/x`;
}

/** Loader Daten der Seite in die Form der API Antwort ({ data: Bericht }), damit dieselben Schemas passen. */
export function meetingReportToApiResponse(routeData: JsonRecord): { data: JsonRecord; error: null } {
    const report = routeData.meetingReport;

    if (typeof report !== "object" || report === null || Array.isArray(report)) {
        throw new RemixContextParseError("Spielbericht loader data has no meetingReport.");
    }

    return { data: report as JsonRecord, error: null };
}
