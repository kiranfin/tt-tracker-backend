import { ClubPlayersResponseSchema } from "../schemas.js";
import type { ClubPlayersResponse } from "../schemas.js";
import { parseUpstream } from "../upstream/parse.js";
import { getRouteDataWithHtmlFallback } from "./request.js";
import { searchClubs } from "./search.js";
import { asNullableNumber, asNullableString, asRecord } from "./values.js";

const ANDRO_CLUB_NR_OVERRIDES: Record<string, string> = {
    // Manuelle Notfall-Overrides bleiben möglich.
    // Format: "VERBAND:clickTTClubId": "klassische andro-Vereinsnummer"
    // TTV Pleidelsheim
    "TTBW:2055064": "08065"
};

const ANDRO_ASSOCIATION_PATTERNS: Record<string, string> = {
    TTBW: "DE.SW.R5.20"
};

type AndroClubNrResolutionSource =
    | "explicit"
    | "cache"
    | "manual_override"
    | "direct"
    | "dynamic_search"
    | "unresolved";

type AndroClubNrResolution = {
    clubNr: string;
    source: AndroClubNrResolutionSource;
};

/**
 * Merkzettel für die aufgelöste Andro Vereinsnummer (click-TT Nummer zu Andro Nummer). Die Source
 * Schicht hat keinen Cache, deshalb reicht der Service einen Speicher herein.
 */
export type ResolvedAndroClubNrStore = {
    get: (organization: string, clubNumber: string) => string | undefined;
    set: (organization: string, clubNumber: string, androClubNr: string) => void;
};

function getAndroAssociationPattern(organization: string) {
    return ANDRO_ASSOCIATION_PATTERNS[organization.toUpperCase()] ?? "all";
}

function normalizeAndroGender(value: unknown): string | null {
    const gender = asNullableString(value);

    if (gender === "male") {
        return "m";
    }

    if (gender === "female") {
        return "w";
    }

    return gender;
}

function getAndroRankingRoot(value: unknown): Record<string, unknown> {
    const direct = asRecord(value);

    if (Object.keys(asRecord(direct.blockLoaderData)).length > 0) {
        return direct;
    }

    const pageContent = asRecord(direct.pageContent);

    if (Object.keys(asRecord(pageContent.blockLoaderData)).length > 0) {
        return pageContent;
    }

    return direct;
}

function findAndroRankingBlock(value: unknown): Record<string, unknown> | null {
    const root = getAndroRankingRoot(value);
    const blockLoaderData = asRecord(root.blockLoaderData);

    for (const block of Object.values(blockLoaderData)) {
        const record = asRecord(block);

        if (Array.isArray(record.entries)) {
            return record;
        }
    }

    return null;
}

export function getAndroEntriesCount(value: unknown) {
    const block = findAndroRankingBlock(value);
    const entries = Array.isArray(block?.entries) ? block.entries : [];

    return entries.length;
}

export const ANDRO_RANKING_PATH = "/rankings/andro-rangliste";

// Die Seite liefert JSON nur mit diesem User Agent.
export const ANDRO_RANKING_HEADERS = { "user-agent": "curl/8.4.0" };

export function buildAndroRankingSearchParams(params: {
    organization: string;
    androClubNr: string;
}) {
    return new URLSearchParams({
        clubnr: params.androClubNr,
        fednickname: params.organization,
        continent: "all",
        country: "all",
        gender: "all",
        as: getAndroAssociationPattern(params.organization),
        "birth-range": "1926;2021",
        "ttr-range": "100;3000",
        "results-per-page": "100",
        page: "1",
        "current-ranking": "yes",
        "all-players": "on",
        _data: "routes/$"
    });
}

async function fetchAndroRankingRaw(params: {
    organization: string;
    androClubNr: string;
}) {
    const searchParams = buildAndroRankingSearchParams({
        organization: params.organization,
        androClubNr: params.androClubNr
    });

    const sourcePath = `${ANDRO_RANKING_PATH}?${searchParams.toString()}`;

    const raw = await getRouteDataWithHtmlFallback({
        name: "andro_ranking",
        path: ANDRO_RANKING_PATH,
        searchParams,
        schema: {
            parse: (value) => value
        },
        extraHeaders: ANDRO_RANKING_HEADERS
    });

    return {
        raw,
        sourcePath
    };
}

function normalizeClubNameForCompare(value: string) {
    return value
        .trim()
        .toLowerCase()
        .replaceAll("ä", "ae")
        .replaceAll("ö", "oe")
        .replaceAll("ü", "ue")
        .replaceAll("ß", "ss")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function scoreClubNameMatch(queryNormalized: string, candidateName: string) {
    const candidateNormalized = normalizeClubNameForCompare(candidateName);

    if (!queryNormalized || !candidateNormalized) {
        return 0;
    }

    if (candidateNormalized === queryNormalized) {
        return 100;
    }

    if (candidateNormalized.includes(queryNormalized)) {
        return 80;
    }

    if (queryNormalized.includes(candidateNormalized)) {
        return 70;
    }

    const queryParts = new Set(queryNormalized.split(" "));
    const candidateParts = new Set(candidateNormalized.split(" "));

    let overlap = 0;

    for (const part of queryParts) {
        if (candidateParts.has(part)) {
            overlap += 1;
        }
    }

    return overlap;
}

async function findAndroClubNrCandidates(params: {
    organization: string;
    clubName?: string;
}) {
    const clubName = params.clubName?.trim();

    if (!clubName) {
        return [];
    }

    const searchResult = await searchClubs({
        query: clubName,
        page: 1,
        pagesize: 10
    });

    const normalizedQuery = normalizeClubNameForCompare(clubName);

    return searchResult.results
        .filter((club) => {
            const org = String(club.organization_short ?? "").toUpperCase();
            return org === params.organization.toUpperCase();
        })
        .map((club) => ({
            clubNr: String(club.clubnr ?? "").trim(),
            clubName: String(club.clubname ?? "").trim(),
            score: scoreClubNameMatch(
                normalizedQuery,
                String(club.clubname ?? "")
            )
        }))
        .filter((candidate) => candidate.clubNr.length > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 5);
}

function getInitialAndroClubNrResolution(params: {
    organization: string;
    clubNumber: string;
    androClubNr?: string;
    resolved?: ResolvedAndroClubNrStore;
}): AndroClubNrResolution {
    const organization = params.organization.toUpperCase();
    const cacheKey = `${organization}:${params.clubNumber}`;

    if (params.androClubNr?.trim()) {
        return {
            clubNr: params.androClubNr.trim(),
            source: "explicit"
        };
    }

    const cached = params.resolved?.get(organization, params.clubNumber);

    if (cached) {
        return {
            clubNr: cached,
            source: "cache"
        };
    }

    const manualOverride = ANDRO_CLUB_NR_OVERRIDES[cacheKey];

    if (manualOverride) {
        return {
            clubNr: manualOverride,
            source: "manual_override"
        };
    }

    return {
        clubNr: params.clubNumber,
        source: "direct"
    };
}

function normalizeAndroRankingResponse(params: {
    value: unknown;
    organization: string;
    clickttClubId: string;
    androClubNr: string;
    sourcePath: string;
    resolutionSource: AndroClubNrResolutionSource;
}): ClubPlayersResponse {
    const root = getAndroRankingRoot(params.value);
    const block = findAndroRankingBlock(params.value);

    if (!block) {
        return parseUpstream(ClubPlayersResponseSchema, {
            data: [],
            pagination: {
                page: 1,
                page_size: 100,
                pages_count: 0,
                total_count: 0,
                max_rows: null
            },
            access_level: asNullableString(root.userContentAccessLevel),
            source_path: params.sourcePath,
            page_url: asNullableString(root.pageUrl),
            resolved_club_nr: params.androClubNr,
            requested_club_nr: params.clickttClubId,
            resolution_source: params.resolutionSource,
            error: null
        }, "andro_ranking");
    }

    const entries = Array.isArray(block.entries) ? block.entries : [];

    const data = entries.map((rawEntry) => {
        const entry = asRecord(rawEntry);

        const firstname = asNullableString(entry.firstname) ?? "";
        const lastname = asNullableString(entry.lastname) ?? "";
        const fullName = `${firstname} ${lastname}`.trim();

        const personId = asNullableString(entry.personId);
        const externalId = asNullableString(entry.external_id);
        const association =
            asNullableString(entry.fedNickname) ?? params.organization;
        const clubNr = asNullableString(entry.clubNr) ?? params.androClubNr;
        const position = asNullableNumber(entry.position);
        const rankingIdentity =
            personId ?? (fullName.length > 0 ? fullName : "unknown");

        return {
            person_id: personId,
            internal_id: personId,

            firstname,
            lastname,
            full_name: fullName,

            ttr: asNullableNumber(entry.fedRank),
            qttr: asNullableNumber(entry.fedRank),
            player_qttr: asNullableNumber(entry.fedRank),

            rank: position,
            club_rank: position,
            global_rank: asNullableNumber(entry.rank),
            national_rank: asNullableNumber(entry.germanRank),

            gender: normalizeAndroGender(entry.gender),
            gender_raw: asNullableString(entry.gender),
            country: asNullableString(entry.country),
            continent: asNullableString(entry.continent),

            club_nr: clubNr,
            clicktt_club_id: params.clickttClubId,
            club_name: asNullableString(entry.clubName),
            association,

            match_count: asNullableNumber(entry.matchCount),
            few_games: asNullableNumber(entry.fewGames),
            last_year_no_games: asNullableString(entry.lastYearNoGames),

            club_sex_rank: asNullableNumber(entry.clubSexRank),
            german_sex_rank: asNullableNumber(entry.germanSexRank),

            external_id: externalId,
            player_url: externalId
                ? `https://www.mytischtennis.de/community/external-profile?user-id=${externalId}`
                : null,

            ranking_id: [
                association,
                clubNr,
                position ?? "unknown",
                rankingIdentity
            ].join(":")
        };
    });

    return parseUpstream(ClubPlayersResponseSchema, {
        data,
        pagination: {
            page: (asNullableNumber(block.currentPage) ?? 0) + 1,
            page_size: asNullableNumber(block.resultsPerPage) ?? 100,
            pages_count: asNullableNumber(block.numberOfPages) ?? 0,
            total_count: asNullableNumber(block.resultLength) ?? data.length,
            max_rows: asNullableNumber(block.maxRows)
        },
        access_level: asNullableString(root.userContentAccessLevel),
        source_path: params.sourcePath,
        page_url: asNullableString(root.pageUrl),
        resolved_club_nr: params.androClubNr,
        requested_club_nr: params.clickttClubId,
        resolution_source: params.resolutionSource,
        error: null
    }, "andro_ranking");
}

export async function getClubPlayersFromAndroRanking(params: {
    organization: string;
    clubNumber: string;
    androClubNr?: string;
    clubName?: string;
    resolved?: ResolvedAndroClubNrStore;
    // Die Kandidatensuche (bis zu 8 weitere Abrufe nacheinander) nicht selbst machen, sondern dem
    // Aufrufer melden, der sie im Hintergrund nachholt. Bis dahin kommt die unaufgelöste Antwort.
    deferCandidateSearch?: () => void;
}): Promise<ClubPlayersResponse> {
    const organization = params.organization.trim().toUpperCase();

    const initialResolution = getInitialAndroClubNrResolution({
        organization,
        clubNumber: params.clubNumber,
        androClubNr: params.androClubNr,
        resolved: params.resolved
    });

    const initial = await fetchAndroRankingRaw({
        organization,
        androClubNr: initialResolution.clubNr
    });

    const initialEntriesCount = getAndroEntriesCount(initial.raw);

    if (initialEntriesCount > 0 || params.androClubNr?.trim()) {
        if (
            initialEntriesCount > 0 &&
            initialResolution.source !== "explicit"
        ) {
            params.resolved?.set(organization, params.clubNumber, initialResolution.clubNr);
        }

        return normalizeAndroRankingResponse({
            value: initial.raw,
            organization,
            clickttClubId: params.clubNumber,
            androClubNr: initialResolution.clubNr,
            sourcePath: initial.sourcePath,
            resolutionSource: initialResolution.source
        });
    }

    // Ein veralteter Override oder gemerkter Wert darf nicht verhindern, dass die click-tt Nummer selbst gilt.
    if (initialResolution.clubNr !== params.clubNumber) {
        const direct = await fetchAndroRankingRaw({
            organization,
            androClubNr: params.clubNumber
        });

        if (getAndroEntriesCount(direct.raw) > 0) {
            params.resolved?.set(organization, params.clubNumber, params.clubNumber);

            return normalizeAndroRankingResponse({
                value: direct.raw,
                organization,
                clickttClubId: params.clubNumber,
                androClubNr: params.clubNumber,
                sourcePath: direct.sourcePath,
                resolutionSource: "direct"
            });
        }
    }

    if (params.deferCandidateSearch) {
        params.deferCandidateSearch();

        return normalizeAndroRankingResponse({
            value: initial.raw,
            organization,
            clickttClubId: params.clubNumber,
            androClubNr: initialResolution.clubNr,
            sourcePath: initial.sourcePath,
            resolutionSource: "unresolved"
        });
    }

    const candidates = await findAndroClubNrCandidates({
        organization,
        clubName: params.clubName
    });

    for (const candidate of candidates) {
        if (candidate.clubNr === initialResolution.clubNr) {
            continue;
        }

        const candidateResult = await fetchAndroRankingRaw({
            organization,
            androClubNr: candidate.clubNr
        });

        if (getAndroEntriesCount(candidateResult.raw) > 0) {
            params.resolved?.set(organization, params.clubNumber, candidate.clubNr);

            return normalizeAndroRankingResponse({
                value: candidateResult.raw,
                organization,
                clickttClubId: params.clubNumber,
                androClubNr: candidate.clubNr,
                sourcePath: candidateResult.sourcePath,
                resolutionSource: "dynamic_search"
            });
        }
    }

    return normalizeAndroRankingResponse({
        value: initial.raw,
        organization,
        clickttClubId: params.clubNumber,
        androClubNr: initialResolution.clubNr,
        sourcePath: initial.sourcePath,
        resolutionSource: "unresolved"
    });
}
