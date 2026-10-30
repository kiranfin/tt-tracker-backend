import type { MeetingLiveData, MeetingPlayer } from "../schemas.js";
import { normalizePlayerId } from "../mytt/rating.js";
import { asNullableNumber } from "../mytt/values.js";

export type PlayerSingle = {
    meetingId: string;
    date: string | null;
    teamHome: string | null;
    teamGuest: string | null;
    won: boolean;
    setsOwn: number;
    setsOther: number;
    opponent: {
        personId: string;
        name: string;
        /** Verband und Vereinsnummer des Gegners, um seinen öffentlichen Wert in der Vereinsliste zu finden. */
        organization: string | null;
        clubNumber: string | null;
    };
};

function playerName(player: MeetingPlayer) {
    return `${player.firstname ?? ""} ${player.lastname ?? ""}`.trim();
}

function asString(value: unknown) {
    return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

/**
 * Alle gewerteten Einzel eines Spielers aus einem Spielbericht. Doppel, kampflose Spiele und
 * Spiele ohne eindeutiges Ergebnis fallen weg.
 */
export function extractPlayerSingles(
    meeting: MeetingLiveData,
    meetingId: string,
    nuid: string
): PlayerSingle[] {
    const wanted = normalizePlayerId(nuid);
    const record = meeting as Record<string, unknown>;

    const homeClubNumber = asString(record.team_home_club_nr);
    const guestClubNumber = asString(record.team_guest_club_nr);
    const meetingOrganization = asString(record.fed_nickname);

    const singles: PlayerSingle[] = [];

    for (const match of meeting.match ?? []) {
        if (match.game_type !== "single") {
            continue;
        }

        const matchRecord = match as Record<string, unknown>;

        if (matchRecord.home_wo === true || matchRecord.guest_wo === true) {
            continue;
        }

        const home = match.mm_player11;
        const guest = match.mm_player21;

        if (!home?.person_id || !guest?.person_id) {
            continue;
        }

        const isHome = normalizePlayerId(home.person_id) === wanted;
        const isGuest = normalizePlayerId(guest.person_id) === wanted;

        if (!isHome && !isGuest) {
            continue;
        }

        const setsHome = asNullableNumber(match.sets_home);
        const setsGuest = asNullableNumber(match.sets_guest);

        if (setsHome === null || setsGuest === null || setsHome === setsGuest) {
            continue;
        }

        const opponent = isHome ? guest : home;
        const opponentRecord = opponent as Record<string, unknown>;

        singles.push({
            meetingId,
            date: meeting.scheduled ?? null,
            teamHome: meeting.team_home ?? null,
            teamGuest: meeting.team_guest ?? null,
            won: isHome ? setsHome > setsGuest : setsGuest > setsHome,
            setsOwn: isHome ? setsHome : setsGuest,
            setsOther: isHome ? setsGuest : setsHome,
            opponent: {
                personId: opponent.person_id!,
                name: playerName(opponent),
                organization: asString(opponentRecord.player_fed_nickname) ?? meetingOrganization,
                clubNumber: isHome ? guestClubNumber : homeClubNumber
            }
        });
    }

    return singles;
}
