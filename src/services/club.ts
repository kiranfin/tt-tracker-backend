import { cacheKeys } from "../cacheKeys.js";
import { peekCached, putCached } from "../cache/index.js";
import { getClubPlayersFromAndroRanking, type ResolvedAndroClubNrStore } from "../mytt/androRanking.js";
import {
    getClubHead,
    getClubInfo,
    getClubSchedule,
    getClubTeams
} from "../mytt/club.js";
import { getFreshMs } from "../policies.js";
import type { ClubPlayersResponse, ClubScheduleResponse } from "../schemas.js";
import { getCurrentSeasonSegment } from "../utils/season.js";
import { readByPolicy, type ServiceResult } from "./read.js";

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Merkzettel für die aufgelöste Andro Vereinsnummer, abgelegt im normalen Cache. */
const androClubNrStore: ResolvedAndroClubNrStore = {
    get: (organization, clubNumber) =>
        peekCached<string>(cacheKeys.androClubNr(organization, clubNumber)),
    set: (organization, clubNumber, androClubNr) =>
        putCached(
            cacheKeys.androClubNr(organization, clubNumber),
            androClubNr,
            getFreshMs("ANDRO_CLUB_NR", androClubNr)
        )
};

// Kopf (Logo) pro Verein, saisonunabhängig gecacht. Info Seite und Logo Endpoint teilen sich den Eintrag.
function readClubHead(organization: string, clubNumber: string, season = getCurrentSeasonSegment()) {
    return readByPolicy({
        kind: "CLUB_HEAD",
        key: cacheKeys.clubHead(organization, clubNumber),
        load: () => getClubHead({ organization, clubNumber, season })
    });
}

/**
 * Logos für mehrere Vereine: { "TTBW:2055064": url | null }. Fehlt ein Verein in der Antwort, ist der
 * Abruf gescheitert und die App darf es später erneut versuchen. null heißt: Verein hat kein Logo.
 */
export async function getClubLogos(
    refs: string[],
    onError?: (error: unknown, ref: string) => void
): Promise<Record<string, string | null>> {
    const results = await Promise.all(
        refs.map(async (ref) => {
            const [organization, clubNumber] = ref.split(":");

            try {
                const head = await readClubHead(organization!, clubNumber!);

                return [ref, head.value.logoUrl] as const;
            } catch (error) {
                onError?.(error, ref);

                return null;
            }
        })
    );

    return Object.fromEntries(results.filter((entry) => entry !== null));
}

export function getClubInfoData(params: {
    organization: string;
    clubNumber: string;
    season: string;
    clubSlug: string;
}) {
    return readByPolicy({
        kind: "CLUB_INFO",
        key: cacheKeys.clubInfo(params.organization, params.clubNumber, params.season),
        load: () =>
            getClubInfo(
                params,
                async () =>
                    (await readClubHead(params.organization, params.clubNumber, params.season)).value
            )
    });
}

export function getClubTeamList(params: { organization: string; clubNumber: string }) {
    return readByPolicy({
        kind: "CLUB_TEAMS",
        key: cacheKeys.clubTeams(params.organization, params.clubNumber),
        load: () => getClubTeams(params)
    });
}

/**
 * Vereinsliste aus der Andro Rangliste über den Cache. Eine Stelle für den Cache Key, damit die
 * Vereinsroute und die Rating Suche denselben Eintrag nutzen (der Vereinsname gehört nicht in den Key).
 */
export async function getClubPlayerList(params: {
    organization: string;
    clubNumber: string;
    androClubNr?: string;
    clubName?: string;
}): Promise<ServiceResult<ClubPlayersResponse>> {
    const baseKey = cacheKeys.clubPlayers(params.organization, params.clubNumber, params.androClubNr);

    const read = (key: string) =>
        readByPolicy({
            kind: "CLUB_PLAYERS",
            key,
            load: () => getClubPlayersFromAndroRanking({ ...params, resolved: androClubNrStore })
        });

    const result = await read(baseKey);

    // Ohne Namen lässt sich die Andro Vereinsnummer beim ersten Abruf manchmal nicht auflösen. Eine
    // leere Liste von so einem Aufruf soll nicht die Aufrufer blockieren, die den Namen mitbringen.
    const clubName = params.clubName?.trim();

    if (result.value.data.length === 0 && clubName && !params.androClubNr?.trim()) {
        return read(cacheKeys.clubPlayersByName(baseKey, clubName));
    }

    return result;
}

/** Vereinsspielplan über den Cache. Die Club Route und die TTR Schätzung teilen sich den Eintrag. */
export function getClubScheduleData(params: {
    organization: string;
    clubNumber: string;
    season: string;
    clubSlug: string;
    dateStart?: string;
    dateEnd?: string;
}) {
    return readByPolicy({
        kind: "CLUB_SCHEDULE",
        key: cacheKeys.clubSchedule(params),
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
