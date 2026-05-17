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
    is_excluded: z.boolean().nullable().optional(),
    is_excluded_date: z.string().nullable().optional(),
    is_excluded_text: z.string().nullable().optional()
});

export const LeagueTableResponseSchema = z.object({
    data: z.array(LeagueTableRowSchema).default([]),
    error: z.unknown().nullable().optional()
});

export type LeagueTableRow = z.infer<typeof LeagueTableRowSchema>;
export type LeagueTableResponse = z.infer<typeof LeagueTableResponseSchema>;

export type PlayerSearchItem = z.infer<typeof PlayerSearchItemSchema>;
export type PlayerSearchResponse = z.infer<typeof PlayerSearchResponseSchema>;

export type ClubSearchItem = z.infer<typeof ClubSearchItemSchema>;
export type ClubSearchResponse = z.infer<typeof ClubSearchResponseSchema>;

export type ClubTeam = z.infer<typeof ClubTeamSchema>;
export type ClubTeamsResponse = z.infer<typeof ClubTeamsResponseSchema>;

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