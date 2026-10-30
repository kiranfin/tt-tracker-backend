export const CACHE_TTL = {
    PLAYER_SEARCH: 5 * 60 * 1000,
    PLAYER_TTR: 30 * 60 * 1000,
    PLAYER_TTR_HISTORY: 60 * 60 * 1000,
    PLAYER_TTR_ESTIMATE: 30 * 60 * 1000,

    CLUB_SEARCH: 15 * 60 * 1000,
    CLUB_TEAMS: 60 * 60 * 1000,
    // Adressen, Spiellokale und Vorstand ändern sich selten.
    CLUB_INFO: 12 * 60 * 60 * 1000,
    // Vereinslogos (Layout Loader), ändern sich fast nie.
    CLUB_HEAD: 7 * 24 * 60 * 60 * 1000,
    LEAGUE_TABLE: 15 * 60 * 1000,
    LEAGUE_SCHEDULE: 60 * 60 * 1000,

    // Leere Tabellen und Spielpläne (Saison noch nicht begonnen oder Format verschoben) schnell neu prüfen.
    EMPTY_RESULT: 2 * 60 * 1000,

    MEETING_LIVE: 30 * 1000,
    MEETING_PLANNED: 2 * 60 * 1000,
    // Abgeschlossene Spielberichte ändern sich nicht mehr. Länger als CACHE_STALE_MAX_AGE_MS (7 Tage)
    // bringt nichts, ältere Einträge fallen beim Neustart und beim Aufräumen ohnehin raus.
    MEETING_COMPLETED: 7 * 24 * 60 * 60 * 1000,

    EVENTS_LIST: 30 * 60 * 1000,
    EVENTS_DETAIL: 60 * 60 * 1000
} as const;

export const TTR_ESTIMATE = {
    // Obergrenzen pro Anfrage, damit eine Schätzung nicht beliebig viele Abrufe bei myTischtennis auslöst.
    MAX_MEETINGS: 40,
    MAX_OPPONENT_CLUBS: 24,
    // Eine Schätzung lädt bis zu 40 Berichte und 24 Vereinslisten. Schnell hintereinander löst das bei
    // myTischtennis ein 429 aus, auch wenn das 30 Minuten Kontingent noch lange nicht verbraucht ist.
    CONCURRENCY: 2,
    // Wie viele Tage der öffentliche Wert hinter den Spielberichten herhinkt. 0, bis die Aktualität der
    // Andro Rangliste geprüft ist: dann steckt jedes gespielte Einzel schon im öffentlichen Wert.
    PUBLIC_RATING_LAG_DAYS: 0
} as const;
