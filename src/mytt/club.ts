import {
    ClubHeadDataResponseSchema,
    ClubInfoResponseSchema,
    ClubScheduleResponseSchema,
    ClubTeamsResponseSchema
} from "../schemas.js";
import type { ClubInfoContact, ClubScheduleResponse, ClubTeamsResponse } from "../schemas.js";
import { validateClubSchedule } from "../sources/validate.js";
import { UpstreamFormatError } from "../upstream/errors.js";
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

const CLUB_ROUTE_PREFIX = "routes/click-tt+/$association+/$season+/verein.$clubid.$clubname+";

export const CLUB_SCHEDULE_ROUTE_ID = `${CLUB_ROUTE_PREFIX}/spielplan`;
export const CLUB_LAYOUT_ROUTE_ID = `${CLUB_ROUTE_PREFIX}/_layout`;
export const CLUB_INFO_ROUTE_ID = `${CLUB_ROUTE_PREFIX}/info`;

export function buildClubContextPath(params: {
    association: string;
    season: string;
    clubNumber: string;
    clubSlug?: string;
    page: "spielplan" | "info";
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
    const searchParams = new URLSearchParams({ _data: CLUB_SCHEDULE_ROUTE_ID });

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
        schema: ClubScheduleResponseSchema,
        validate: validateClubSchedule
    });
}

export type ClubInfoPerson = {
    label: string | null;
    name: string | null;
    street: string | null;
    zipcode: string | null;
    city: string | null;
    website: string | null;
    note: string | null;
    email: string | null;
    phone: string | null;
};

export type ClubOfficial = {
    role: string | null;
    name: string | null;
    email: string | null;
    phone: string | null;
};

// Aufbereitete Vereinsinfos aus Layout (Logo) und Info Seite.
export type ClubInfo = {
    clubNumber: string;
    clubName: string | null;
    logoUrl: string | null;
    region: string | null;
    foundationYear: number | null;
    organizationName: string | null;
    association: string;
    season: string;
    contact: ClubInfoPerson | null;
    venues: ClubInfoPerson[];
    officials: ClubOfficial[];
};

const CLUB_LOGO_BASE_URL = "https://ttde-portal.liga.nu/rs/2014/images/";

function clean(value: string | null | undefined): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
}

function isWebsite(value: string | null) {
    return Boolean(value && /^(https?:\/\/|www\.)\S+$/i.test(value));
}

// Layout liefert "1985-01-01 00:00:00", die Info Seite denselben Tag als UTC ("1984-12-31T23:00:00.000+00:00").
export function parseFoundationYear(value: string | null | undefined): number | null {
    const text = clean(value);
    if (!text) return null;

    if (!text.includes("T")) {
        const year = Number(text.slice(0, 4));
        return Number.isInteger(year) && year > 1800 ? year : null;
    }

    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return null;

    return new Date(date.getTime() + 12 * 60 * 60 * 1000).getUTCFullYear();
}

function toPerson(entry: ClubInfoContact): ClubInfoPerson {
    const website = clean(entry.website);

    return {
        label: clean(entry.label),
        name: clean(entry.contact_name),
        street: clean(entry.street),
        zipcode: clean(entry.zipcode),
        city: clean(entry.city),
        website: isWebsite(website) ? website : null,
        note: isWebsite(website) ? null : website,
        email: clean(entry.email_home) ?? clean(entry.email_work),
        phone: clean(entry.phone_home) ?? clean(entry.phone_work) ?? clean(entry.phone_mobile)
    };
}

// Funktionäre bewusst ohne Privatadresse, nur Rolle, Name und Kontaktweg.
function toOfficial(entry: ClubInfoContact): ClubOfficial {
    return {
        role: clean(entry.role),
        name: clean(entry.contact_name),
        email: clean(entry.email_home) ?? clean(entry.email_work),
        phone: clean(entry.phone_mobile) ?? clean(entry.phone_home) ?? clean(entry.phone_work)
    };
}

export async function getClubInfo(params: {
    organization: string;
    clubNumber: string;
    season: string;
    clubSlug?: string;
}): Promise<ClubInfo> {
    const path = buildClubContextPath({
        association: params.organization,
        season: params.season,
        clubNumber: params.clubNumber,
        clubSlug: params.clubSlug,
        page: "info"
    });

    // Das Logo ist nur Beiwerk, ein Fehler im Layout Loader soll die Infos nicht blockieren.
    const [info, head] = await Promise.all([
        getRouteDataWithHtmlFallback({
            name: "club_info",
            path,
            searchParams: new URLSearchParams({ _data: CLUB_INFO_ROUTE_ID }),
            schema: ClubInfoResponseSchema,
            validate: (value, source) => {
                if (!clean(value.data?.club_nr) && !clean(value.data?.club_name)) {
                    throw new UpstreamFormatError(source, ["data.club_nr und data.club_name fehlen"]);
                }

                return value;
            }
        }),
        getRouteDataWithHtmlFallback({
            name: "club_layout",
            path,
            searchParams: new URLSearchParams({ _data: CLUB_LAYOUT_ROUTE_ID }),
            schema: ClubHeadDataResponseSchema
        }).catch(() => null)
    ]);

    const data = info.data;
    const headData = head?.headData;
    const contacts = data?.club_infos?.club_contacts ?? [];
    const officials = data?.club_infos?.club_officials ?? [];

    const venues = contacts.filter((entry) => /spiellokal/i.test(entry.label ?? "")).map(toPerson);
    const contactEntry = contacts.find((entry) => !/spiellokal/i.test(entry.label ?? ""));
    const logoId = clean(headData?.logo_id);

    return {
        clubNumber: clean(data?.club_nr) ?? params.clubNumber,
        clubName: clean(data?.club_name) ?? clean(headData?.club_name),
        logoUrl: logoId
            ? `${CLUB_LOGO_BASE_URL}${encodeURIComponent(logoId)}?pixelHeight=160&onlyScaleSmaller=true&quality=0.9`
            : null,
        region: clean(data?.region_name) ?? clean(headData?.region_name),
        foundationYear: parseFoundationYear(headData?.foundation_year) ?? parseFoundationYear(data?.foundation_year),
        organizationName: clean(data?.organization_name),
        association: params.organization,
        season: params.season,
        contact: contactEntry ? toPerson(contactEntry) : null,
        venues,
        officials: officials.map(toOfficial).filter((official) => official.name)
    };
}
