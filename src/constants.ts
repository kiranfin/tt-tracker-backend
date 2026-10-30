export const TTR_ESTIMATE = {
    // Alle vergangenen Begegnungen der Saison. Abgelegte Berichte kosten nichts, die Last begrenzt
    // MAX_NEW_MEETINGS.
    MAX_MEETINGS: 300,
    // Neue Berichte, die eine Anfrage höchstens bei myTischtennis lädt. Der Rest folgt bei den nächsten Aufrufen.
    MAX_NEW_MEETINGS: 10,
    // Spiele anderer Mannschaften des Vereins (z.B. Ersatzspiele), die zusätzlich geladen werden, sobald die
    // Mannschaft des Spielers bekannt ist. Seine eigenen Spiele kommen immer zuerst und vollständig.
    MAX_OTHER_TEAM_MEETINGS: 10,
    MAX_OPPONENT_CLUBS: 24,
    // Eine Schätzung lädt bis zu 10 neue Berichte und 24 Vereinslisten. Schnell hintereinander löst das bei
    // myTischtennis ein 429 aus, auch wenn das 30 Minuten Kontingent noch lange nicht verbraucht ist.
    CONCURRENCY: 2,
    // Wie viele Tage der öffentliche Wert hinter den Spielberichten herhinkt. 0, bis die Aktualität der
    // Andro Rangliste geprüft ist: dann steckt jedes gespielte Einzel schon im öffentlichen Wert.
    PUBLIC_RATING_LAG_DAYS: 0
} as const;
