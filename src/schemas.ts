import { z } from "zod";

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

export type PlayerSearchItem = z.infer<typeof PlayerSearchItemSchema>;
export type PlayerSearchResponse = z.infer<typeof PlayerSearchResponseSchema>;

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