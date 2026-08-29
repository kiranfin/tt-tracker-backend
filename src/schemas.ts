import { z } from "zod";

const StringOrNumberSchema = z.union([z.string(), z.number()]);

export const PlayerSearchItemSchema = z.object({
    lastname: z.string().nullable().optional(),
    firstname: z.string().nullable().optional(),
    person_id: z.number().nullable().optional(),
    internal_id: z.string().nullable().optional(),
    licence_club: z.string().nullable().optional(),
    dttb_player_id: z.string().nullable().optional(),
    club_name: z.string().nullable().optional()
});

export const PlayerSearchResponseSchema = z.object({
    results: z.array(PlayerSearchItemSchema).default([]),
    total_count: z.number().optional(),
    pages_count: z.number().optional(),
    page: z.number().optional(),
    pagesize: z.number().optional()
});

export const ClubSearchItemSchema = z.object({
    external_id: z.string().nullable().optional(),
    clubname: z.string().nullable().optional(),
    clubnr: z.string().nullable().optional(),
    organization_id: z.number().nullable().optional(),
    organization_name: z.string().nullable().optional(),
    organization_short: z.string().nullable().optional()
});

export const ClubSearchResponseSchema = z.object({
    results: z.array(ClubSearchItemSchema).default([]),
    total_count: z.number().optional(),
    pages_count: z.number().optional(),
    page: z.number().optional(),
    pagesize: z.number().optional()
});

export const ClubTeamSchema = z.object({
    season: z.string().nullable().optional(),
    team_id: StringOrNumberSchema.nullable().optional(),
    group_id: StringOrNumberSchema.nullable().optional(),
    team_name: z.string().nullable().optional(),
    points_won: StringOrNumberSchema.nullable().optional(),
    points_lost: StringOrNumberSchema.nullable().optional(),
    table_rank: StringOrNumberSchema.nullable().optional(),
    league_name: z.string().nullable().optional(),
    team_organisation_short: z.string().nullable().optional()
});

export const ClubTeamsResponseSchema = z.object({
    data: z.array(ClubTeamSchema).default([]),
    error: z.unknown().nullable().optional()
});

export const ClubPlayerSchema = z
    .object({
        person_id: z.string().nullable().optional(),
        internal_id: z.string().nullable().optional(),

        firstname: z.string().nullable().optional(),
        lastname: z.string().nullable().optional(),
        full_name: z.string().nullable().optional(),

        ttr: StringOrNumberSchema.nullable().optional(),
        qttr: StringOrNumberSchema.nullable().optional(),
        player_qttr: StringOrNumberSchema.nullable().optional(),

        rank: StringOrNumberSchema.nullable().optional(),
        club_rank: StringOrNumberSchema.nullable().optional(),
        global_rank: StringOrNumberSchema.nullable().optional(),
        national_rank: StringOrNumberSchema.nullable().optional(),

        gender: z.string().nullable().optional(),
        gender_raw: z.string().nullable().optional(),
        country: z.string().nullable().optional(),
        continent: z.string().nullable().optional(),

        club_nr: z.string().nullable().optional(),
        clicktt_club_id: z.string().nullable().optional(),
        club_name: z.string().nullable().optional(),
        association: z.string().nullable().optional(),

        match_count: StringOrNumberSchema.nullable().optional(),
        few_games: StringOrNumberSchema.nullable().optional(),
        last_year_no_games: z.string().nullable().optional(),

        club_sex_rank: StringOrNumberSchema.nullable().optional(),
        german_sex_rank: StringOrNumberSchema.nullable().optional(),

        external_id: z.string().nullable().optional(),
        player_url: z.string().nullable().optional(),

        ranking_id: z.string().nullable().optional()
    })
    .passthrough();

export const ClubPlayersResponseSchema = z
    .object({
        data: z.array(ClubPlayerSchema).default([]),
        pagination: z
            .object({
                page: z.number().optional(),
                page_size: z.number().optional(),
                pages_count: z.number().optional(),
                total_count: z.number().optional(),
                max_rows: z.number().nullable().optional()
            })
            .passthrough(),
        access_level: z.string().nullable().optional(),
        source_path: z.string().nullable().optional(),
        page_url: z.string().nullable().optional(),
        resolved_club_nr: z.string().nullable().optional(),
        requested_club_nr: z.string().nullable().optional(),
        resolution_source: z
            .enum(["explicit", "cache", "manual_override", "direct", "dynamic_search", "unresolved"])
            .nullable()
            .optional(),
        error: z.unknown().nullable().optional()
    })
    .passthrough();

export const LeagueTableRowSchema = z.object({
    club_id: StringOrNumberSchema.nullable().optional(),
    team_id: StringOrNumberSchema.nullable().optional(),
    team_name: z.string().nullable().optional(),

    table_rank: StringOrNumberSchema.nullable().optional(),

    points_won: StringOrNumberSchema.nullable().optional(),
    points_lost: StringOrNumberSchema.nullable().optional(),

    meetings_count: StringOrNumberSchema.nullable().optional(),
    meetings_won: StringOrNumberSchema.nullable().optional(),
    meetings_tie: StringOrNumberSchema.nullable().optional(),
    meetings_lost: StringOrNumberSchema.nullable().optional(),

    matches_won: StringOrNumberSchema.nullable().optional(),
    matches_lost: StringOrNumberSchema.nullable().optional(),
    matches_relation: z.string().nullable().optional(),

    sets_won: StringOrNumberSchema.nullable().optional(),
    sets_lost: StringOrNumberSchema.nullable().optional(),
    sets_relation: z.string().nullable().optional(),

    games_won: StringOrNumberSchema.nullable().optional(),
    games_lost: StringOrNumberSchema.nullable().optional(),
    games_relation: z.string().nullable().optional(),

    tendency: z.string().nullable().optional(),
    rise_fall_state: z.string().nullable().optional(),
    promotion_state: z
        .enum(["promotion", "relegation", "none"])
        .nullable()
        .optional(),
    is_excluded: z.boolean().nullable().optional(),
    is_excluded_date: z.string().nullable().optional(),
    is_excluded_text: z.string().nullable().optional()
});

export const LeagueTableResponseSchema = z.object({
    data: z.array(LeagueTableRowSchema).default([]),
    error: z.unknown().nullable().optional()
});

export const LocationSchema = z.object({
    zip: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    label: z.string().nullable().optional(),
    street: z.string().nullable().optional(),
    country: z.string().nullable().optional()
});

export const LeagueScheduleMeetingSchema = z.object({
    date: z.string().nullable().optional(),
    end_date: z.string().nullable().optional(),

    live: z.boolean().nullable().optional(),
    state: z.string().nullable().optional(),

    league_id: StringOrNumberSchema.nullable().optional(),
    league_name: z.string().nullable().optional(),
    league_short_name: z.string().nullable().optional(),
    league_org_short_name: z.string().nullable().optional(),

    team_home: z.string().nullable().optional(),
    team_away: z.string().nullable().optional(),
    team_home_id: StringOrNumberSchema.nullable().optional(),
    team_away_id: StringOrNumberSchema.nullable().optional(),
    team_home_club_id: StringOrNumberSchema.nullable().optional(),
    team_away_club_id: StringOrNumberSchema.nullable().optional(),

    meeting_id: StringOrNumberSchema.nullable().optional(),
    meeting_number: StringOrNumberSchema.nullable().optional(),

    matches_won: StringOrNumberSchema.nullable().optional(),
    matches_lost: StringOrNumberSchema.nullable().optional(),

    round_name: z.string().nullable().optional(),
    round_type: StringOrNumberSchema.nullable().optional(),

    location: LocationSchema.nullable().optional(),

    is_confirmed: z.boolean().nullable().optional(),
    is_meeting_complete: z.boolean().nullable().optional(),
    is_provisionally_recorded: z.boolean().nullable().optional(),
    nu_score_live_enabled: z.boolean().nullable().optional(),

    pdf_url: z.string().nullable().optional()
});

export const LeagueScheduleDateGroupSchema = z.record(
    z.array(LeagueScheduleMeetingSchema)
);

export const LeagueScheduleResponseSchema = z.object({
    season: z.string().nullable().optional(),
    association: z.string().nullable().optional(),
    groupname: z.string().nullable().optional(),
    urlid: StringOrNumberSchema.nullable().optional(),
    season_filter: z.string().nullable().optional(),
    seasonType: z.string().nullable().optional(),
    filter: z.string().nullable().optional(),
    error: z.unknown().nullable().optional(),

    data: z.object({
        remarks: z.unknown().nullable().optional(),
        meetings: z.array(LeagueScheduleDateGroupSchema).default([]),
        round_type: z.string().nullable().optional(),
        pdf_version_url: z.string().nullable().optional(),
        pdf_materials_url: z.string().nullable().optional()
    }).optional()
});

export const TeamPlayerSchema = z
    .object({
        firstname: z.string().nullable().optional(),
        lastname: z.string().nullable().optional(),
        internal_id: z.string().nullable().optional(),
        rank: StringOrNumberSchema.nullable().optional(),
        team_number: StringOrNumberSchema.nullable().optional(),
        player_qttr: StringOrNumberSchema.nullable().optional(),
        player_status: z.string().nullable().optional(),
        foreigner_type: z.string().nullable().optional()
    })
    .passthrough();

export const TeamPlayersResponseSchema = z
    .object({
        data: z.array(z.unknown()).default([]),
        error: z.unknown().nullable().optional()
    })
    .passthrough();

export const TeamSimpleScheduleItemSchema = z
    .object({
        opponent_team_id: StringOrNumberSchema.nullable().optional(),
        opponent_team_name: z.string().nullable().optional(),
        date: z.string().nullable().optional(),
        matches_won: StringOrNumberSchema.nullable().optional(),
        matches_lost: StringOrNumberSchema.nullable().optional(),
        meeting_id: StringOrNumberSchema.nullable().optional()
    })
    .passthrough();

export const TeamSimpleScheduleResponseSchema = z
    .object({
        data: z.array(z.unknown()).default([]),
        error: z.unknown().nullable().optional()
    })
    .passthrough();

export const TeamHeadInfosSchema = z
    .object({
        season: z.string().nullable().optional(),
        play_mode: z.string().nullable().optional(),
        league_name: z.string().nullable().optional(),
        championship: z.string().nullable().optional(),
        gender_age_group: z.string().nullable().optional(),
        organization_short: z.string().nullable().optional()
    })
    .passthrough();

export const TeamContactSchema = z
    .object({
        contact_name: z.string().nullable().optional(),
        street: z.string().nullable().optional(),
        zipcode: z.string().nullable().optional(),
        city: z.string().nullable().optional(),
        phone_home: z.string().nullable().optional(),
        phone_work: z.string().nullable().optional(),
        phone_mobile: z.string().nullable().optional(),
        email_home: z.string().nullable().optional(),
        email_work: z.string().nullable().optional()
    })
    .passthrough();

export const TeamVenueSchema = z
    .object({
        label: z.string().nullable().optional(),
        street: z.string().nullable().optional(),
        zipcode: z.string().nullable().optional(),
        city: z.string().nullable().optional(),
        website: z.string().nullable().optional()
    })
    .passthrough();

export const TeamMeetingsExcerptSchema = z
    .object({
        remarks: z.unknown().nullable().optional(),
        meetings: z.array(z.unknown()).default([]),
        round_type: z.string().nullable().optional(),
        pdf_version_url: z.string().nullable().optional(),
        pdf_materials_url: z.string().nullable().optional()
    })
    .passthrough();

export const TeamInfoDataSchema = z
    .object({
        head_infos: TeamHeadInfosSchema.nullable().optional(),
        team_contact: TeamContactSchema.nullable().optional(),
        venue: TeamVenueSchema.nullable().optional(),
        team_photo_url: z.string().nullable().optional(),
        meetings_excerpt: TeamMeetingsExcerptSchema.nullable().optional()
    })
    .passthrough();

export const TeamInfoResponseSchema = z
    .object({
        data: TeamInfoDataSchema.nullable().optional(),
        season: z.string().nullable().optional(),
        association: z.string().nullable().optional(),
        error: z.unknown().nullable().optional()
    })
    .passthrough();

export const TeamScheduleDataSchema = z
    .object({
        head_infos: TeamHeadInfosSchema.nullable().optional(),
        schedule: z.array(z.unknown()).default([]),
        meetings_excerpt: TeamMeetingsExcerptSchema.nullable().optional()
    })
    .passthrough();

export const TeamScheduleResponseSchema = z
    .object({
        data: TeamScheduleDataSchema.nullable().optional(),
        season: z.string().nullable().optional(),
        association: z.string().nullable().optional(),
        season_filter: z.string().nullable().optional(),
        error: z.unknown().nullable().optional()
    })
    .passthrough();

export const TeamBalanceSplitSchema = z
    .object({
        opponent_rank: StringOrNumberSchema.nullable().optional(),
        points_won: StringOrNumberSchema.nullable().optional(),
        points_lost: StringOrNumberSchema.nullable().optional()
    })
    .passthrough();

export const TeamBalancePlayerSchema = z
    .object({
        player_id: z.string().nullable().optional(),
        player_firstname: z.string().nullable().optional(),
        player_lastname: z.string().nullable().optional(),
        meetings_count: StringOrNumberSchema.nullable().optional(),
        points_won: StringOrNumberSchema.nullable().optional(),
        points_lost: StringOrNumberSchema.nullable().optional(),
        player_rank: StringOrNumberSchema.nullable().optional(),
        team_number: StringOrNumberSchema.nullable().optional(),
        single_statistics: z.array(TeamBalanceSplitSchema).default([])
    })
    .passthrough();

export const TeamBalancesDataSchema = z
    .object({
        head_infos: TeamHeadInfosSchema.nullable().optional(),
        player_balances: z.array(z.unknown()).default([]),
        meetings_excerpt: TeamMeetingsExcerptSchema.nullable().optional()
    })
    .passthrough();

export const TeamBalancesResponseSchema = z
    .object({
        data: TeamBalancesDataSchema.nullable().optional(),
        season: z.string().nullable().optional(),
        association: z.string().nullable().optional(),
        season_filter: z.string().nullable().optional(),
        error: z.unknown().nullable().optional()
    })
    .passthrough();

export const MeetingPlayerSchema = z
    .object({
        firstname: z.string().nullable().optional(),
        lastname: z.string().nullable().optional(),
        person_id: z.string().nullable().optional()
    })
    .passthrough();

export const MeetingMatchSchema = z
    .object({
        match_name: z.string().nullable().optional(),
        game_type: z.string().nullable().optional(),

        sets_home: StringOrNumberSchema.nullable().optional(),
        sets_guest: StringOrNumberSchema.nullable().optional(),

        set1_home: StringOrNumberSchema.nullable().optional(),
        set1_guest: StringOrNumberSchema.nullable().optional(),
        set2_home: StringOrNumberSchema.nullable().optional(),
        set2_guest: StringOrNumberSchema.nullable().optional(),
        set3_home: StringOrNumberSchema.nullable().optional(),
        set3_guest: StringOrNumberSchema.nullable().optional(),
        set4_home: StringOrNumberSchema.nullable().optional(),
        set4_guest: StringOrNumberSchema.nullable().optional(),
        set5_home: StringOrNumberSchema.nullable().optional(),
        set5_guest: StringOrNumberSchema.nullable().optional(),

        mm_player11: MeetingPlayerSchema.nullable().optional(),
        mm_player12: MeetingPlayerSchema.nullable().optional(),
        mm_player21: MeetingPlayerSchema.nullable().optional(),
        mm_player22: MeetingPlayerSchema.nullable().optional()
    })
    .passthrough();

export const MeetingLiveDataSchema = z
    .object({
        live: z.boolean().nullable().optional(),
        is_completed: z.boolean().nullable().optional(),
        has_nu_live_push_data: z.boolean().nullable().optional(),

        scheduled: z.string().nullable().optional(),

        team_home: z.string().nullable().optional(),
        team_guest: z.string().nullable().optional(),

        matches_home: StringOrNumberSchema.nullable().optional(),
        matches_guest: StringOrNumberSchema.nullable().optional(),

        sets_home: StringOrNumberSchema.nullable().optional(),
        sets_guest: StringOrNumberSchema.nullable().optional(),

        match: z.array(MeetingMatchSchema).default([])
    })
    .passthrough();

export const MeetingLiveResponseSchema = z.object({
    data: MeetingLiveDataSchema.nullable().optional(),
    error: z.unknown().nullable().optional()
});

export const PlayerTtrResponseSchema = z.object({
    ttr: StringOrNumberSchema.nullable().optional(),
    error: z.unknown().nullable().optional()
});

export const PlayerTtrEventMatchSchema = z
    .object({
        type: z.string().nullable().optional(),
        own_sets: StringOrNumberSchema.nullable().optional(),
        other_sets: StringOrNumberSchema.nullable().optional(),
        other_ttr: StringOrNumberSchema.nullable().optional(),
        scheduled: z.string().nullable().optional(),
        own_person_name: z.string().nullable().optional(),
        other_person_name: z.string().nullable().optional()
    })
    .passthrough();

export const PlayerTtrEventSchema = z
    .object({
        event_id: StringOrNumberSchema.nullable().optional(),
        event_name: z.string().nullable().optional(),
        event_date_time: z.string().nullable().optional(),

        ttr_before: StringOrNumberSchema.nullable().optional(),
        ttr_after: StringOrNumberSchema.nullable().optional(),
        ttr_delta: StringOrNumberSchema.nullable().optional(),

        match_count: StringOrNumberSchema.nullable().optional(),
        matches_won: StringOrNumberSchema.nullable().optional(),
        matches_lost: StringOrNumberSchema.nullable().optional(),

        expected_result: z.string().nullable().optional(),
        alteration_constant: StringOrNumberSchema.nullable().optional(),

        match: z.array(PlayerTtrEventMatchSchema).default([])
    })
    .passthrough();

export const PlayerTtrHistoryResponseSchema = z
    .object({
        ttr: StringOrNumberSchema.nullable().optional(),
        vq_ttr: StringOrNumberSchema.nullable().optional(),
        max_ttr: StringOrNumberSchema.nullable().optional(),

        ttr_date: z.string().nullable().optional(),
        max_ttr_date: z.string().nullable().optional(),

        club_name: z.string().nullable().optional(),
        person_id: z.string().nullable().optional(),
        person_name: z.string().nullable().optional(),

        event: z.array(PlayerTtrEventSchema).default([]),
        error: z.unknown().nullable().optional()
    })
    .passthrough();

export const ClubScheduleLocationSchema = z
    .object({
        label: z.string().nullable().optional(),
        city: z.string().nullable().optional()
    })
    .passthrough();

export const ClubScheduleMeetingSchema = z
    .object({
        date: z.string().nullable().optional(),
        state: z.string().nullable().optional(),
        team_home: z.string().nullable().optional(),
        team_away: z.string().nullable().optional(),
        team_home_id: z.union([z.string(), z.number()]).nullable().optional(),
        team_away_id: z.union([z.string(), z.number()]).nullable().optional(),
        matches_won: z.union([z.string(), z.number()]).nullable().optional(),
        matches_lost: z.union([z.string(), z.number()]).nullable().optional(),
        meeting_id: z.union([z.string(), z.number()]).nullable().optional(),
        league_name: z.string().nullable().optional(),
        league_short_name: z.string().nullable().optional(),
        location: ClubScheduleLocationSchema.nullable().optional()
    })
    .passthrough();

export const ClubScheduleResponseSchema = z
    .object({
        data: z
            .object({
                head_infos: z.record(z.unknown()).nullable().optional(),
                club_name: z.string().nullable().optional(),
                meetings: z.array(ClubScheduleMeetingSchema).optional().default([]),
                meetings_by_date: z.unknown().optional()
            })
            .passthrough(),
        season: z.string().nullable().optional(),
        association: z.string().nullable().optional(),
        error: z.unknown().nullable().optional()
    })
    .passthrough();

export type ClubScheduleResponse = z.infer<typeof ClubScheduleResponseSchema>;

export type MeetingPlayer = z.infer<typeof MeetingPlayerSchema>;
export type MeetingMatch = z.infer<typeof MeetingMatchSchema>;
export type MeetingLiveData = z.infer<typeof MeetingLiveDataSchema>;
export type MeetingLiveResponse = z.infer<typeof MeetingLiveResponseSchema>;

export type LeagueScheduleMeeting = z.infer<typeof LeagueScheduleMeetingSchema>;
export type LeagueScheduleResponse = z.infer<typeof LeagueScheduleResponseSchema>;

export type LeagueTableRow = z.infer<typeof LeagueTableRowSchema>;
export type LeagueTableResponse = z.infer<typeof LeagueTableResponseSchema>;

export type PlayerSearchItem = z.infer<typeof PlayerSearchItemSchema>;
export type PlayerSearchResponse = z.infer<typeof PlayerSearchResponseSchema>;

export type ClubSearchItem = z.infer<typeof ClubSearchItemSchema>;
export type ClubSearchResponse = z.infer<typeof ClubSearchResponseSchema>;

export type ClubTeam = z.infer<typeof ClubTeamSchema>;
export type ClubTeamsResponse = z.infer<typeof ClubTeamsResponseSchema>;

export type ClubPlayer = z.infer<typeof ClubPlayerSchema>;
export type ClubPlayersResponse = z.infer<typeof ClubPlayersResponseSchema>;

export type PlayerTtrResponse = z.infer<typeof PlayerTtrResponseSchema>;
export type PlayerTtrHistoryResponse = z.infer<typeof PlayerTtrHistoryResponseSchema>;
export type PlayerTtrEvent = z.infer<typeof PlayerTtrEventSchema>;

export type TeamPlayer = z.infer<typeof TeamPlayerSchema>;
export type TeamPlayersResponse = z.infer<typeof TeamPlayersResponseSchema>;

export type TeamSimpleScheduleItem = z.infer<typeof TeamSimpleScheduleItemSchema>;
export type TeamSimpleScheduleResponse = z.infer<typeof TeamSimpleScheduleResponseSchema>;

export type TeamInfoResponse = z.infer<typeof TeamInfoResponseSchema>;
export type TeamScheduleResponse = z.infer<typeof TeamScheduleResponseSchema>;
export type TeamBalancesResponse = z.infer<typeof TeamBalancesResponseSchema>;
export type TeamBalancePlayer = z.infer<typeof TeamBalancePlayerSchema>;

// --- Dancing Park events (scraped from dancing-park.de) ---

export const EventSummarySchema = z.object({
    id: z.string(), // GUID from /event/?id=...
    title: z.string(),
    date: z.string(), // "YYYY-MM-DD"
    startTime: z.string().nullable(), // "21:30"
    endTime: z.string().nullable(), // "05:00"
    endsNextDay: z.boolean(), // "(+1)" marker in the source
    weekday: z.string().nullable(), // "Samstag"
    rawDateText: z.string(), // original text, kept for debugging/fallback
    imageUrl: z.string().nullable(),
    detailUrl: z.string(),
    reservationUrl: z.string().nullable(),
    u18Url: z.string().nullable()
});

export const EventListResponseSchema = z.array(EventSummarySchema);

export const EventPriceSchema = z.object({
    label: z.string(),
    value: z.string()
});

export const EventDetailSchema = EventSummarySchema.extend({
    description: z.string().nullable(),
    prices: z.array(EventPriceSchema).default([])
});

export type EventSummary = z.infer<typeof EventSummarySchema>;
export type EventListResponse = z.infer<typeof EventListResponseSchema>;
export type EventPrice = z.infer<typeof EventPriceSchema>;
export type EventDetail = z.infer<typeof EventDetailSchema>;

export type ApiResponse<T> = {
    data: T;
    meta: {
        source: "cache" | "upstream";
    };
};

export type ApiErrorResponse = {
    error: {
        code:
            | "INVALID_INPUT"
            | "RATE_LIMITED"
            | "UPSTREAM_DISABLED"
            | "UPSTREAM_ERROR"
            | "INTERNAL_ERROR";
        message: string;
    };
};