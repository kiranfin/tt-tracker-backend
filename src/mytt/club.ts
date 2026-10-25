import { ClubScheduleResponseSchema, ClubTeamsResponseSchema } from "../schemas.js";
import type { ClubScheduleResponse, ClubTeamsResponse } from "../schemas.js";
import { getJsonFromMytt, getRouteDataWithHtmlFallback } from "./request.js";

export async function getClubTeams(params: {
    clubNumber: string;
    organization: string;
}): Promise<ClubTeamsResponse> {
    const searchParams = new URLSearchParams({
        clubNumber: params.clubNumber,
        organization: params.organization
    });

    return getJsonFromMytt({
        path: "/api/ttr/teams",
        searchParams,
        schema: ClubTeamsResponseSchema
    });
}

function buildClubContextPath(params: {
    association: string;
    season: string;
    clubNumber: string;
    clubSlug?: string;
    page: "spielplan";
}) {
    const clubSlug = params.clubSlug?.trim() || "x";

    const segments = [
        "click-tt",
        params.association,
        params.season,
        "verein",
        params.clubNumber,
        clubSlug,
        params.page
    ];

    return `/${segments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

export async function getClubSchedule(params: {
    organization: string;
    clubNumber: string;
    season: string;
    clubSlug?: string;
    dateStart?: string;
    dateEnd?: string;
}): Promise<ClubScheduleResponse> {
    const searchParams = new URLSearchParams({
        _data:
            "routes/click-tt+/$association+/$season+/verein.$clubid.$clubname+/spielplan"
    });

    if (params.dateStart) {
        searchParams.set("date_start", params.dateStart);
    }

    if (params.dateEnd) {
        searchParams.set("date_end", params.dateEnd);
    }

    return getRouteDataWithHtmlFallback({
        name: "club_schedule",
        path: buildClubContextPath({
            association: params.organization,
            season: params.season,
            clubNumber: params.clubNumber,
            clubSlug: params.clubSlug,
            page: "spielplan"
        }),
        searchParams,
        schema: ClubScheduleResponseSchema
    });
}
