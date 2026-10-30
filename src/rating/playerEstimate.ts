import { TTR_ESTIMATE } from "../constants.js";
import { getClubScheduleMeetings, readClubSchedule, readMeeting } from "../mytt/cachedReads.js";
import { readClubPlayers } from "../mytt/clubPlayersCache.js";
import { lookupPublicPlayer } from "../mytt/playerLookup.js";
import { normalizePlayerId, toPublicRating, type PlayerRating } from "../mytt/rating.js";
import { asNullableNumber } from "../mytt/values.js";
import { hasStoredMeeting } from "../store/meetingStore.js";
import {
    getOpponentRatings,
    opponentRatingKey,
    saveOpponentRatings,
    type OpponentRatingRow
} from "../store/opponentRatingStore.js";
import { LocalRateLimitError, UpstreamRateLimitError } from "../upstream/errors.js";
import { runInBackground } from "../upstream/priority.js";
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
        /**
         * Berichte und Einzel, die diese Anfrage wegen ihres Budgets noch nicht geschafft hat. Ist der Wert
         * größer als 0, ist die Schätzung unvollständig und der nächste Aufruf rechnet weiter.
         */
        pending: number;
    };
    assumptions: {
        k: number;
        lagDays: number;
    };
};

/**
 * myTischtennis bremst gerade oder der Breaker ist offen. Dann fehlen nicht einzelne Berichte, sondern
 * alle weiteren: eine Schätzung daraus wäre unvollständig und würde 30 Minuten lang die letzte gute
 * überdecken. Lieber abbrechen, dann liefert der Cache die vorige Schätzung als stale.
 */
export function isTemporarilyBlocked(error: unknown) {
    return error instanceof LocalRateLimitError || error instanceof UpstreamRateLimitError;
}

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

/**
 * Teilt die vergangenen Begegnungen (neueste zuerst) auf: abgelegte kosten nichts und kommen alle mit,
 * von den fehlenden werden höchstens `budget` geladen, und zwar die neuesten. `pending` ist die Zahl
 * der fehlenden, die danach noch übrig bleiben.
 */
export function planMeetingScan<T extends { id: string }>(
    pastMeetings: T[],
    isStored: (meetingId: string) => boolean,
    budget: number
) {
    const fromStore: T[] = [];
    const missing: T[] = [];

    for (const meeting of pastMeetings) {
        (isStored(meeting.id) ? fromStore : missing).push(meeting);
    }

    const toLoad = missing.slice(0, Math.max(0, budget));

    return { fromStore, toLoad, pending: missing.length - toLoad.length };
}

// Vergangene Berichte, die nicht abgeschlossen oder nicht ladbar sind (verlegt, noch nicht eingetragen).
// Sie würden sonst bei jeder Anfrage das Budget der neuesten Berichte aufbrauchen und die älteren blockieren.
const UNFINISHED_RETRY_MS = 60 * 60 * 1000;
const unfinishedMeetings = new Map<string, number>();

function isSkippedForNow(meetingId: string, now: number) {
    const retryAt = unfinishedMeetings.get(meetingId);

    if (retryAt === undefined) {
        return false;
    }

    if (now >= retryAt) {
        unfinishedMeetings.delete(meetingId);
        return false;
    }

    return true;
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

/**
 * Werte der Gegner pro Einzel (Schlüssel aus `keyOf`). Gespeicherte Werte bleiben, wie sie beim ersten
 * Bewerten waren. Nur für Einzel ohne gespeicherten Wert werden die (gecachten) Vereinslisten geladen
 * und die gefundenen Werte sofort gespeichert. `deferred` zählt Einzel, deren Verein wegen der
 * Obergrenze erst beim nächsten Aufruf drankommt.
 */
async function loadOpponentRatings(singles: PlayerSingle[]) {
    const keyOf = (single: PlayerSingle) =>
        opponentRatingKey({
            meetingId: single.meetingId,
            personId: normalizePlayerId(single.opponent.personId)
        });

    const ratings = getOpponentRatings(
        singles.map((single) => ({
            meetingId: single.meetingId,
            personId: normalizePlayerId(single.opponent.personId)
        }))
    );

    const open = singles.filter((single) => !ratings.has(keyOf(single)));
    const clubs = new Map<string, { organization: string; clubNumber: string; clubName?: string }>();

    for (const single of open) {
        const { organization, clubNumber, clubName } = single.opponent;

        if (organization && clubNumber) {
            clubs.set(`${organization}:${clubNumber}`, {
                organization: organization.toUpperCase(),
                clubNumber,
                clubName: clubName ?? undefined
            });
        }
    }

    const allClubs = [...clubs.entries()];
    const wanted = allClubs.slice(0, TTR_ESTIMATE.MAX_OPPONENT_CLUBS);
    const deferredClubs = new Set(allClubs.slice(TTR_ESTIMATE.MAX_OPPONENT_CLUBS).map(([key]) => key));
    const current = new Map<string, number>();

    await mapWithConcurrency(wanted, TTR_ESTIMATE.CONCURRENCY, ([, club]) =>
        runInBackground(async () => {
            try {
                const list = await readClubPlayers(club);

                for (const player of list.value.data) {
                    const ttr = asNullableNumber(player.ttr);
                    const id = normalizePlayerId(player.person_id);

                    if (ttr !== null && id) {
                        current.set(id, ttr);
                    }
                }
            } catch (error) {
                if (isTemporarilyBlocked(error)) throw error;

                // Ein Verein ohne Liste lässt nur seine Spieler als "ohne Wert" zurück.
            }
        })
    );

    const fresh: OpponentRatingRow[] = [];
    let deferred = 0;

    for (const single of open) {
        const personId = normalizePlayerId(single.opponent.personId);
        const ttr = current.get(personId);

        if (ttr !== undefined) {
            ratings.set(keyOf(single), ttr);
            fresh.push({ meetingId: single.meetingId, personId, ttr });
        } else if (
            single.opponent.organization &&
            single.opponent.clubNumber &&
            deferredClubs.has(`${single.opponent.organization}:${single.opponent.clubNumber}`)
        ) {
            deferred += 1;
        }
    }

    saveOpponentRatings(fresh);

    return { ratings, keyOf, deferred };
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
            pending: 0,
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
    const candidates = pastMeetings
        .slice(0, TTR_ESTIMATE.MAX_MEETINGS)
        .filter((meeting) => !isSkippedForNow(meeting.id, now));

    const plan = planMeetingScan(candidates, hasStoredMeeting, TTR_ESTIMATE.MAX_NEW_MEETINGS);
    const scanned = [...plan.fromStore, ...plan.toLoad];
    const loading = new Set(plan.toLoad.map((meeting) => meeting.id));

    const reports = await mapWithConcurrency(scanned, TTR_ESTIMATE.CONCURRENCY, async (meeting) => {
        const isNew = loading.has(meeting.id);

        const read = async () => {
            try {
                const report = await readMeeting(meeting.id);

                // Nicht abgelegt heißt nicht abgeschlossen: nicht bei jeder Anfrage erneut versuchen.
                if (isNew && !hasStoredMeeting(meeting.id)) {
                    unfinishedMeetings.set(meeting.id, now + UNFINISHED_RETRY_MS);
                }

                return report.value.data ? extractPlayerSingles(report.value.data, meeting.id, params.nuid) : [];
            } catch (error) {
                if (isTemporarilyBlocked(error)) throw error;

                if (isNew) {
                    unfinishedMeetings.set(meeting.id, now + UNFINISHED_RETRY_MS);
                }

                return [];
            }
        };

        // Abgelegte Berichte kosten keinen Upstream Request, nur neue laufen als Hintergrundarbeit.
        return isNew ? runInBackground(read) : read();
    });

    const singles = reports.flat();
    const opponents = await loadOpponentRatings(singles);

    const rated: RatedSingle[] = [];

    for (const single of singles) {
        const opponentTtr = opponents.ratings.get(opponents.keyOf(single));

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
            truncated: pastMeetings.length > scanned.length,
            pending: plan.pending + opponents.deferred
        },
        assumptions: { k: BASE_K, lagDays }
    };
}
