import { TTR_ESTIMATE } from "../constants.js";
import { getClubScheduleMeetings, readClubSchedule, readMeeting } from "../mytt/cachedReads.js";
import { readClubPlayers } from "../mytt/clubPlayersCache.js";
import { lookupPublicPlayer } from "../mytt/playerLookup.js";
import { normalizePlayerId, toPublicRating, type PlayerRating } from "../mytt/rating.js";
import { asNullableNumber } from "../mytt/values.js";
import { getCurrentSeasonSegment, getDefaultSeasonDates } from "../utils/season.js";
import { buildTimeline, type EstimatedEvent, type RatedSingle } from "./estimate.js";
import { BASE_K } from "./formula.js";
import { extractPlayerSingles, type PlayerSingle } from "./playerMatches.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export type PlayerTtrEstimate = {
    nuid: string;
    available: boolean;
    /** Öffentlicher Wert aus der Vereinsliste, Ausgangspunkt der Schätzung. */
    publicRating: PlayerRating | null;
    /** "estimated", wenn Spiele nach dem öffentlichen Stand dazugerechnet wurden, sonst "public". */
    rating: PlayerRating | null;
    /** Ältestes Einzel zuerst. */
    events: EstimatedEvent[];
    coverage: {
        meetingsTotal: number;
        meetingsScanned: number;
        singlesFound: number;
        singlesRated: number;
        /** Einzel, deren Gegner keinen öffentlichen Wert in der Vereinsliste hatte. */
        singlesUnrated: number;
        truncated: boolean;
    };
    assumptions: {
        k: number;
        lagDays: number;
    };
};

async function mapWithConcurrency<T, R>(
    items: T[],
    limit: number,
    task: (item: T) => Promise<R>
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;

    async function worker() {
        while (next < items.length) {
            const index = next;
            next += 1;
            results[index] = await task(items[index]!);
        }
    }

    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));

    return results;
}

function meetingTimestamp(meeting: Record<string, unknown>) {
    const timestamp = typeof meeting.date === "string" ? Date.parse(meeting.date) : Number.NaN;

    return Number.isFinite(timestamp) ? timestamp : null;
}

/** Vergangene Spiele des Vereins, neueste zuerst. */
function getPastMeetingIds(schedule: Parameters<typeof getClubScheduleMeetings>[0], now: number) {
    return getClubScheduleMeetings(schedule)
        .map((meeting) => ({
            id: meeting.meeting_id === null || meeting.meeting_id === undefined ? "" : String(meeting.meeting_id),
            timestamp: meetingTimestamp(meeting)
        }))
        .filter((item): item is { id: string; timestamp: number } => item.id !== "" && item.timestamp !== null && item.timestamp < now)
        .sort((left, right) => right.timestamp - left.timestamp);
}

/** Öffentliche Werte der Gegner, nach Person gesucht in den (gecachten) Vereinslisten. */
async function loadOpponentRatings(singles: PlayerSingle[]) {
    const clubs = new Map<string, { organization: string; clubNumber: string; clubName?: string }>();

    for (const single of singles) {
        const { organization, clubNumber, clubName } = single.opponent;

        if (organization && clubNumber) {
            clubs.set(`${organization}:${clubNumber}`, {
                organization: organization.toUpperCase(),
                clubNumber,
                clubName: clubName ?? undefined
            });
        }
    }

    const wanted = [...clubs.values()].slice(0, TTR_ESTIMATE.MAX_OPPONENT_CLUBS);
    const ratings = new Map<string, number>();

    await mapWithConcurrency(wanted, TTR_ESTIMATE.CONCURRENCY, async (club) => {
        try {
            const list = await readClubPlayers(club);

            for (const player of list.value.data) {
                const ttr = asNullableNumber(player.ttr);
                const id = normalizePlayerId(player.person_id);

                if (ttr !== null && id) {
                    ratings.set(id, ttr);
                }
            }
        } catch {
            // Ein Verein ohne Liste lässt nur seine Spieler als "ohne Wert" zurück.
        }
    });

    return ratings;
}

export async function estimatePlayerTtr(params: {
    nuid: string;
    organization?: string;
    clubNumber?: string;
    clubName?: string;
    /** Name des Spielers, um den Verein zu finden, wenn er nicht angegeben ist. */
    name?: string;
    now?: number;
}): Promise<PlayerTtrEstimate> {
    const now = params.now ?? Date.now();
    const lagDays = TTR_ESTIMATE.PUBLIC_RATING_LAG_DAYS;

    const empty = (publicRating: PlayerRating | null, coverage?: Partial<PlayerTtrEstimate["coverage"]>) => ({
        nuid: params.nuid,
        available: publicRating !== null,
        publicRating,
        rating: publicRating,
        events: [],
        coverage: {
            meetingsTotal: 0,
            meetingsScanned: 0,
            singlesFound: 0,
            singlesRated: 0,
            singlesUnrated: 0,
            truncated: false,
            ...coverage
        },
        assumptions: { k: BASE_K, lagDays }
    });

    const hit = await lookupPublicPlayer({
        nuid: params.nuid,
        name: params.name,
        organization: params.organization,
        clubNumber: params.clubNumber,
        clubName: params.clubName
    });

    const publicRating = hit ? toPublicRating(hit.player, hit.fetchedAt) : null;

    if (!hit || !publicRating) {
        return empty(null);
    }

    const club = hit.club;

    const season = getCurrentSeasonSegment(new Date(now));
    const { dateStart, dateEnd } = getDefaultSeasonDates(season);

    const schedule = await readClubSchedule({
        organization: club.organization,
        clubNumber: club.clubNumber,
        season,
        clubSlug: "x",
        dateStart,
        dateEnd
    });

    const pastMeetings = getPastMeetingIds(schedule.value, now);
    const scanned = pastMeetings.slice(0, TTR_ESTIMATE.MAX_MEETINGS);

    const reports = await mapWithConcurrency(scanned, TTR_ESTIMATE.CONCURRENCY, async (meeting) => {
        try {
            const report = await readMeeting(meeting.id);

            return report.value.data ? extractPlayerSingles(report.value.data, meeting.id, params.nuid) : [];
        } catch {
            return [];
        }
    });

    const singles = reports.flat();
    const opponentRatings = await loadOpponentRatings(singles);

    const rated: RatedSingle[] = [];

    for (const single of singles) {
        const opponentTtr = opponentRatings.get(normalizePlayerId(single.opponent.personId));

        if (opponentTtr !== undefined) {
            rated.push({ ...single, opponentTtr });
        }
    }

    const timeline = buildTimeline({
        publicValue: publicRating.value,
        publicAsOf: now - lagDays * DAY_MS,
        singles: rated
    });

    return {
        nuid: params.nuid,
        available: true,
        publicRating,
        rating: {
            value: timeline.current,
            source: timeline.adjustedForward ? "estimated" : "public",
            asOf: new Date(now).toISOString()
        },
        events: timeline.events,
        coverage: {
            meetingsTotal: pastMeetings.length,
            meetingsScanned: scanned.length,
            singlesFound: singles.length,
            singlesRated: rated.length,
            singlesUnrated: singles.length - rated.length,
            truncated: pastMeetings.length > scanned.length
        },
        assumptions: { k: BASE_K, lagDays }
    };
}
