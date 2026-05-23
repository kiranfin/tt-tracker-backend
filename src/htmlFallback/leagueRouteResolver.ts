// src/htmlFallback/leagueRouteResolver.ts

type LeagueTableFilter = "gesamt" | "vr" | "rr";

type LeagueRouteOverride = {
    season?: string;
    leagueSlug?: string;
};

function normalizeAssociation(value: string): string {
    return value.trim().toUpperCase();
}

function normalizeSeasonForMytt(value: string): string {
    return value.trim().replaceAll("/", "--");
}

function getCurrentMyttSeason(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0 = Januar, 6 = Juli

    const startYear = month >= 6 ? year : year - 1;
    const endYear = startYear + 1;

    const start = String(startYear % 100).padStart(2, "0");
    const end = String(endYear % 100).padStart(2, "0");

    return `${start}--${end}`;
}

function normalizeFilter(value: string | undefined): LeagueTableFilter {
    if (value === "vr" || value === "rr" || value === "gesamt") {
        return value;
    }

    return "gesamt";
}

function toLeagueSlug(value: string | undefined): string {
    const raw = value?.trim();

    if (!raw) {
        return "x";
    }

    return raw
        .replaceAll("ä", "ae")
        .replaceAll("ö", "oe")
        .replaceAll("ü", "ue")
        .replaceAll("Ä", "Ae")
        .replaceAll("Ö", "Oe")
        .replaceAll("Ü", "Ue")
        .replaceAll("ß", "ss")
        .replaceAll(/[^a-zA-Z0-9.]+/g, "_")
        .replaceAll(/^_+|_+$/g, "");
}

function readRouteOverride(params: {
    association: string;
    groupId: string;
}): LeagueRouteOverride | null {
    const raw = process.env.MYTT_LEAGUE_ROUTE_MAP_JSON;

    if (!raw || raw.trim() === "") {
        return null;
    }

    try {
        const parsed = JSON.parse(raw) as unknown;

        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            return null;
        }

        const key = `${normalizeAssociation(params.association)}:${params.groupId}`;
        const value = (parsed as Record<string, unknown>)[key];

        if (typeof value !== "object" || value === null || Array.isArray(value)) {
            return null;
        }

        const record = value as Record<string, unknown>;

        return {
            season: typeof record.season === "string" ? record.season : undefined,
            leagueSlug:
                typeof record.leagueSlug === "string" ? record.leagueSlug : undefined
        };
    } catch {
        return null;
    }
}

export function buildLeagueTableHtmlPathCandidates(params: {
    association: string;
    groupId: string;
    filter?: string;
}): string[] {
    const association = normalizeAssociation(params.association);
    const groupId = params.groupId.trim();
    const filter = normalizeFilter(params.filter);

    const override = readRouteOverride({
        association,
        groupId
    });

    const seasonCandidates = [
        override?.season,
        process.env.MYTT_DEFAULT_SEASON,
        getCurrentMyttSeason()
    ]
        .filter((value): value is string => Boolean(value && value.trim()))
        .map(normalizeSeasonForMytt);

    const slugCandidates = [
        override?.leagueSlug,
        "x"
    ]
        .filter((value): value is string => Boolean(value && value.trim()))
        .map(toLeagueSlug);

    const paths: string[] = [];

    for (const season of seasonCandidates) {
        for (const leagueSlug of slugCandidates) {
            paths.push(
                `/click-tt/${encodeURIComponent(association)}/${encodeURIComponent(
                    season
                )}/ligen/${encodeURIComponent(leagueSlug)}/gruppe/${encodeURIComponent(
                    groupId
                )}/tabelle/${encodeURIComponent(filter)}`
            );
        }
    }

    return [...new Set(paths)];
}