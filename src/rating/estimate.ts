import { ratingChange } from "./formula.js";
import type { PlayerSingle } from "./playerMatches.js";

export type RatedSingle = PlayerSingle & {
    /** Aktueller öffentlicher Wert des Gegners, nicht der zum Zeitpunkt des Spiels. */
    opponentTtr: number;
};

export type EstimatedEvent = {
    meetingId: string;
    date: string | null;
    teamHome: string | null;
    teamGuest: string | null;
    won: boolean;
    setsOwn: number;
    setsOther: number;
    opponentName: string;
    opponentTtr: number;
    ttrBefore: number;
    ttrAfter: number;
    delta: number;
};

export type EstimateTimeline = {
    /** Stand nach dem letzten Einzel. */
    current: number;
    /** true, wenn Spiele nach dem Stand der öffentlichen Liste noch dazugerechnet wurden. */
    adjustedForward: boolean;
    /** Ältestes Einzel zuerst. */
    events: EstimatedEvent[];
};

function toTimestamp(date: string | null) {
    const timestamp = date ? Date.parse(date) : Number.NaN;

    return Number.isFinite(timestamp) ? timestamp : null;
}

function toEvent(single: RatedSingle, ttrBefore: number, ttrAfter: number): EstimatedEvent {
    return {
        meetingId: single.meetingId,
        date: single.date,
        teamHome: single.teamHome,
        teamGuest: single.teamGuest,
        won: single.won,
        setsOwn: single.setsOwn,
        setsOther: single.setsOther,
        opponentName: single.opponent.name,
        opponentTtr: single.opponentTtr,
        ttrBefore,
        ttrAfter,
        delta: ttrAfter - ttrBefore
    };
}

/**
 * Verlauf aus dem öffentlichen Wert. Spiele bis `publicAsOf` stecken schon im öffentlichen Wert und
 * werden rückwärts davon abgezogen. Spiele danach sind noch nicht enthalten und werden vorwärts
 * dazugerechnet.
 */
export function buildTimeline(params: {
    publicValue: number;
    publicAsOf: number;
    singles: RatedSingle[];
    k?: number;
}): EstimateTimeline {
    const sorted = params.singles
        .map((single, index) => ({ single, index, timestamp: toTimestamp(single.date) }))
        .filter((item): item is typeof item & { timestamp: number } => item.timestamp !== null)
        .sort((left, right) => left.timestamp - right.timestamp || left.index - right.index)
        .map((item) => ({ single: item.single, timestamp: item.timestamp }));

    const included = sorted.filter((item) => item.timestamp <= params.publicAsOf);
    const pending = sorted.filter((item) => item.timestamp > params.publicAsOf);

    // Rückwärts: Wert vor dem Spiel so wählen, dass Wert + Änderung den bekannten Wert danach ergibt.
    const past: EstimatedEvent[] = [];
    let after = params.publicValue;

    for (let index = included.length - 1; index >= 0; index -= 1) {
        const { single } = included[index]!;

        let before = after;

        // Die Änderung hängt vom Wert davor ab, deshalb ein paar Durchläufe bis zur Stabilität.
        for (let pass = 0; pass < 3; pass += 1) {
            const delta = ratingChange({
                own: before,
                opponent: single.opponentTtr,
                won: single.won,
                k: params.k
            });

            before = after - delta;
        }

        past.unshift(toEvent(single, before, after));
        after = before;
    }

    // Vorwärts: Spiele, die der öffentliche Wert noch nicht kennt.
    const future: EstimatedEvent[] = [];
    let running = params.publicValue;

    for (const { single } of pending) {
        const delta = ratingChange({
            own: running,
            opponent: single.opponentTtr,
            won: single.won,
            k: params.k
        });

        future.push(toEvent(single, running, running + delta));
        running += delta;
    }

    return {
        current: running,
        adjustedForward: future.length > 0,
        events: [...past, ...future]
    };
}
