import { readThrough } from "../cache/index.js";
import { CACHE_TTL } from "../constants.js";
import type { ClubScheduleResponse, MeetingLiveResponse } from "../schemas.js";
import { isEmptyClubSchedule, ttlUnlessEmpty } from "../sources/validate.js";
import { getClubSchedule } from "./club.js";
import { getMeetingLive } from "./meeting.js";

const CLUB_SCHEDULE_CACHE_TTL =
    (CACHE_TTL as Record<string, number>).CLUB_SCHEDULE ?? CACHE_TTL.CLUB_TEAMS;

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function getMeetingTtlMs(result: MeetingLiveResponse) {
    if (result.data?.live === true) {
        return CACHE_TTL.MEETING_LIVE;
    }

    return result.data?.is_completed === true
        ? CACHE_TTL.MEETING_COMPLETED
        : CACHE_TTL.MEETING_PLANNED;
}

/** Spielbericht über den Cache. Die Meeting Route und die TTR Schätzung teilen sich den Eintrag. */
export function readMeeting(meetingId: string) {
    return readThrough({
        key: `meeting-live:${meetingId}`,
        ttlMs: getMeetingTtlMs,
        load: () => getMeetingLive({ meetingId })
    });
}

/** Vereinsspielplan über den Cache. Die Club Route und die TTR Schätzung teilen sich den Eintrag. */
export function readClubSchedule(params: {
    organization: string;
    clubNumber: string;
    season: string;
    clubSlug: string;
    dateStart?: string;
    dateEnd?: string;
}) {
    const key = [
        "club-schedule",
        params.organization,
        params.clubNumber,
        params.season,
        params.clubSlug,
        params.dateStart ?? "",
        params.dateEnd ?? ""
    ].join(":");

    return readThrough({
        key,
        ttlMs: ttlUnlessEmpty(CLUB_SCHEDULE_CACHE_TTL, isEmptyClubSchedule),
        load: () => getClubSchedule(params)
    });
}

/** Alle Spiele des Spielplans, je nach Antwort flach in `meetings` oder unter Datumsschlüsseln. */
export function getClubScheduleMeetings(schedule: ClubScheduleResponse): Record<string, unknown>[] {
    const data = schedule.data as Record<string, unknown>;

    const flat = Array.isArray(data.meetings) ? data.meetings : [];
    const dated = Object.entries(data)
        .filter(([key]) => DATE_KEY.test(key))
        .flatMap(([, list]) => (Array.isArray(list) ? list : []));

    return [...flat, ...dated].filter(
        (meeting): meeting is Record<string, unknown> =>
            typeof meeting === "object" && meeting !== null && !Array.isArray(meeting)
    );
}
