/** Skalierung der Wertungsdifferenz: bei 150 Punkten Unterschied gewinnt der Stärkere mit rund 91 Prozent. */
export const TTR_SCALE = 150;

/** Änderungsfaktor ohne Zuschläge. */
export const BASE_K = 16;

export type KFactorOptions = {
    base?: number;
    /** Zuschläge, jeweils nur wenn die Bedingung zutrifft. Standard 0, bis die genauen Werte feststehen. */
    youth?: boolean;
    fewGames?: boolean;
    youthBonus?: number;
    fewGamesBonus?: number;
};

export function kFactor(options: KFactorOptions = {}) {
    const { base = BASE_K, youth = false, fewGames = false, youthBonus = 0, fewGamesBonus = 0 } = options;

    return base + (youth ? youthBonus : 0) + (fewGames ? fewGamesBonus : 0);
}

/** Erwartete Siegwahrscheinlichkeit von Spieler A gegen B: 1 / (1 + 10^((B - A) / 150)). */
export function expectedResult(own: number, opponent: number) {
    return 1 / (1 + 10 ** ((opponent - own) / TTR_SCALE));
}

/** Punkteänderung für Spieler A nach einem Einzel: round((Ergebnis - Erwartung) * k). */
export function ratingChange(params: { own: number; opponent: number; won: boolean; k?: number }) {
    const result = params.won ? 1 : 0;

    return Math.round((result - expectedResult(params.own, params.opponent)) * (params.k ?? BASE_K));
}
