import { fetchWithFallback } from "../sources/fetchWithFallback.js";
import { fetchHtmlPage } from "../sources/html/fetchPage.js";
import { UpstreamFormatError } from "../upstream/errors.js";
import { getJsonFromMytt } from "./request.js";

export const DEFAULT_SEASON = "25--26";

export type AssociationReference = {
    id: string;
    association: string;
    shortName: string;
    name: string;
    androPattern: string | null;
};

export type RegionReference = {
    id: string;
    name: string;
    association: string;
    season: string;
    championshipSlug: string;
    type: "association" | "region";
};

export type LeagueClassReference = {
    id: string;
    name: string;
    contest: string | null;
    association: string;
    season: string;
    championship: string;
    competitionType: "ligen" | "pokalspiele";
    leagueId: string;
    groupId: string;
    groupUrlId: string;
    leagueSlug: string;
};

type LeagueHierarchyUpstream = {
    data?: Array<{
        contest?: string | null;
        groups?: Array<{
            name?: string | null;
            league_id?: string | number | null;
            group_urlid?: string | number | null;
            groupId?: string | number | null;
            urlid?: string | number | null;
            league_slug?: string | null;
            leagueSlug?: string | null;
        }>;
    }>;
    higherLeagues?: unknown[];
    lowerLeagues?: unknown[];
    championship?: string;
    association?: string;
    season?: string;
    seasonType?: string;
    error?: unknown;
};

export const ASSOCIATIONS: AssociationReference[] = [
    {
        id: "DTTB",
        association: "DTTB",
        shortName: "DTTB",
        name: "Deutscher Tischtennis Bund",
        androPattern: null
    },
    {
        id: "BaTTV",
        association: "BaTTV",
        shortName: "BaTTV",
        name: "Baden",
        androPattern: "DE.SW.R5.01"
    },
    {
        id: "TTBW",
        association: "TTBW",
        shortName: "TTBW",
        name: "Baden-Württemberg",
        androPattern: "DE.SW.R5.20"
    },
    {
        id: "ByTTV",
        association: "ByTTV",
        shortName: "ByTTV",
        name: "Bayern",
        androPattern: "DE.SU.R1.02"
    },
    {
        id: "TTVB",
        association: "TTVB",
        shortName: "TTVB",
        name: "Brandenburg",
        androPattern: "DE.NO.R6.04"
    },
    {
        id: "FTTB",
        association: "FTTB",
        shortName: "FTTB",
        name: "Bremen",
        androPattern: "DE.NO.R6.05"
    },
    {
        id: "HaTTV",
        association: "HaTTV",
        shortName: "HaTTV",
        name: "Hamburg",
        androPattern: "DE.NO.R6.06"
    },
    {
        id: "HeTTV",
        association: "HeTTV",
        shortName: "HeTTV",
        name: "Hessen",
        androPattern: "DE.WE.R4.07"
    },
    {
        id: "TTVMV",
        association: "TTVMV",
        shortName: "TTVMV",
        name: "Mecklenburg-Vorpommern",
        androPattern: "DE.NO.R6.08"
    },
    {
        id: "TTVN",
        association: "TTVN",
        shortName: "TTVN",
        name: "Niedersachsen",
        androPattern: "DE.NO.R2.09"
    },
    {
        id: "WTTV",
        association: "WTTV",
        shortName: "WTTV",
        name: "Nordrhein-Westfalen",
        androPattern: "DE.WE.R3.19"
    },
    {
        id: "PTTV",
        association: "PTTV",
        shortName: "PTTV",
        name: "Pfalz",
        androPattern: "DE.SW.R7.10"
    },
    {
        id: "RTTVR",
        association: "RTTVR",
        shortName: "RTTVR",
        name: "Rheinland/Rheinhessen",
        androPattern: "DE.SW.R7.12"
    },
    {
        id: "STTB",
        association: "STTB",
        shortName: "STTB",
        name: "Saarland",
        androPattern: "DE.SW.R7.13"
    },
    {
        id: "TTVSA",
        association: "TTVSA",
        shortName: "TTVSA",
        name: "Sachsen-Anhalt",
        androPattern: "DE.SU.R8.15"
    },
    {
        id: "TTTV",
        association: "TTTV",
        shortName: "TTTV",
        name: "Thüringen",
        androPattern: "DE.SU.R8.18"
    }
];

function normalizeSearchValue(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/&/g, "und")
        .replace(/[^a-z0-9]+/g, "");
}

export function normalizeSeason(value: string | undefined | null): string {
    const season = value?.trim();

    if (!season) {
        return DEFAULT_SEASON;
    }

    return season.replace(/\//g, "--");
}

export function resolveAssociation(value: string): AssociationReference | null {
    const normalized = normalizeSearchValue(value);

    if (!normalized) {
        return null;
    }

    return (
        ASSOCIATIONS.find((item) => {
            const candidates = [
                item.id,
                item.association,
                item.shortName,
                item.name
            ];

            return candidates.some(
                (candidate) => normalizeSearchValue(candidate) === normalized
            );
        }) ?? null
    );
}

function decodeHtmlEntities(value: string): string {
    const namedEntities: Record<string, string> = {
        amp: "&",
        quot: "\"",
        apos: "'",
        lt: "<",
        gt: ">",
        nbsp: " ",
        auml: "ä",
        Auml: "Ä",
        ouml: "ö",
        Ouml: "Ö",
        uuml: "ü",
        Uuml: "Ü",
        szlig: "ß"
    };

    return value
        .replace(/&#(\d+);/g, (_, code: string) =>
            String.fromCharCode(Number.parseInt(code, 10))
        )
        .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) =>
            String.fromCharCode(Number.parseInt(code, 16))
        )
        .replace(/&([a-zA-Z]+);/g, (match, entity: string) =>
            namedEntities[entity] ?? match
        );
}

function stripHtml(value: string): string {
    return decodeHtmlEntities(
        value
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
    );
}

function safeDecodeURIComponent(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function toClickTtLeagueSlug(name: string): string {
    return name
        .trim()
        .replace(/\s*\/\s*/g, "_--_")
        .replace(/\s+/g, "_");
}

function toPath(pathSegments: string[]) {
    return `/${pathSegments.map((segment) => encodeURIComponent(segment)).join("/")}`;
}

function toSearchParams(query?: Record<string, string | undefined>) {
    const searchParams = new URLSearchParams();

    for (const [key, value] of Object.entries(query ?? {})) {
        if (value !== undefined && value !== "") {
            searchParams.set(key, value);
        }
    }

    return searchParams;
}

function fetchMyttPage(pathSegments: string[]) {
    return fetchHtmlPage({ path: toPath(pathSegments) });
}

function fetchMyttJson<T>(pathSegments: string[], query: Record<string, string | undefined>) {
    return getJsonFromMytt({
        name: "league_hierarchy",
        path: toPath(pathSegments),
        searchParams: toSearchParams(query),
        schema: { parse: (value) => value as T }
    });
}

function extractRegionLinks(
    html: string,
    association: string,
    season: string
): RegionReference[] {
    const result: RegionReference[] = [];
    const seen = new Set<string>();
    const marker = `/click-tt/${association}/${season}/ligen/`;
    const linkRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

    let match: RegExpExecArray | null;

    while ((match = linkRegex.exec(html)) !== null) {
        const href = decodeHtmlEntities(match[1] ?? "");
        const label = stripHtml(match[2] ?? "");

        if (!label || label.toLowerCase().startsWith("image:")) {
            continue;
        }

        const markerIndex = href.indexOf(marker);

        if (markerIndex === -1) {
            continue;
        }

        const afterMarker = href
            .slice(markerIndex + marker.length)
            .split(/[?#]/)[0]
            .split("/")[0];

        const championshipSlug = safeDecodeURIComponent(afterMarker);

        if (!championshipSlug || seen.has(championshipSlug)) {
            continue;
        }

        seen.add(championshipSlug);

        const type =
            label.toLowerCase().includes("verbandsspielklasse") ||
            championshipSlug === `SK_${association}_${season}`
                ? "association"
                : "region";

        result.push({
            id: `${association}:${season}:${championshipSlug}`,
            name: label,
            association,
            season,
            championshipSlug,
            type
        });
    }

    return result;
}

export async function loadLeagueRegions(
    association: string,
    season: string
): Promise<{
    association: string;
    season: string;
    regions: RegionReference[];
}> {
    const html = await fetchMyttPage([
        "click-tt",
        association,
        season,
        "ligen"
    ]);

    const regions = extractRegionLinks(html, association, season);

    return {
        association,
        season,
        regions
    };
}

function normalizeLeagueHierarchy(
    raw: LeagueHierarchyUpstream,
    association: string,
    season: string,
    championship: string,
    competitionType: "ligen" | "pokalspiele"
): {
    sections: Array<{
        contest: string | null;
        groups: LeagueClassReference[];
    }>;
    classes: LeagueClassReference[];
    raw: LeagueHierarchyUpstream;
    strategy: "json";
} {
    const sections = (raw.data ?? []).map((section) => {
        const contest = section.contest?.trim() || null;

        const groups = (section.groups ?? [])
            .map((group): LeagueClassReference | null => {
                const name = group.name?.trim() || "Unbekannte Spielklasse";
                const groupId = String(
                    group.group_urlid ?? group.groupId ?? group.urlid ?? ""
                ).trim();

                if (!groupId) {
                    return null;
                }

                const leagueId = String(group.league_id ?? "").trim();
                const leagueSlug =
                    group.league_slug?.trim() ||
                    group.leagueSlug?.trim() ||
                    toClickTtLeagueSlug(name);

                return {
                    id: `${association}:${season}:${groupId}`,
                    name,
                    contest,
                    association,
                    season,
                    championship,
                    competitionType,
                    leagueId,
                    groupId,
                    groupUrlId: groupId,
                    leagueSlug
                };
            })
            .filter((item): item is LeagueClassReference => item !== null);

        return {
            contest,
            groups
        };
    });

    return {
        sections,
        classes: sections.flatMap((section) => section.groups),
        raw,
        strategy: "json"
    };
}

function extractLeagueClassLinks(
    html: string,
    association: string,
    season: string,
    championship: string,
    competitionType: "ligen" | "pokalspiele"
): LeagueClassReference[] {
    const result: LeagueClassReference[] = [];
    const seen = new Set<string>();
    const marker = `/click-tt/${association}/${season}/${competitionType}/`;
    const linkRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

    let match: RegExpExecArray | null;

    while ((match = linkRegex.exec(html)) !== null) {
        const href = decodeHtmlEntities(match[1] ?? "");
        const name = stripHtml(match[2] ?? "");

        if (!name || name.toLowerCase().startsWith("image:")) {
            continue;
        }

        const markerIndex = href.indexOf(marker);

        if (markerIndex === -1) {
            continue;
        }

        const rest = href
            .slice(markerIndex + marker.length)
            .split(/[?#]/)[0];

        const parts = rest.split("/");

        const leagueSlug = safeDecodeURIComponent(parts[0] ?? "");
        const groupKeyword = parts[1];
        const groupId = safeDecodeURIComponent(parts[2] ?? "");

        if (groupKeyword !== "gruppe" || !leagueSlug || !groupId) {
            continue;
        }

        if (seen.has(groupId)) {
            continue;
        }

        seen.add(groupId);

        result.push({
            id: `${association}:${season}:${groupId}`,
            name,
            contest: null,
            association,
            season,
            championship,
            competitionType,
            leagueId: "",
            groupId,
            groupUrlId: groupId,
            leagueSlug
        });
    }

    return result;
}

type LoadedLeagueClasses = {
    sections: Array<{
        contest: string | null;
        groups: LeagueClassReference[];
    }>;
    classes: LeagueClassReference[];
    raw: LeagueHierarchyUpstream | null;
    strategy: "json" | "html";
};

export async function loadLeagueClasses(params: {
    association: string;
    season: string;
    championship: string;
    competitionType: "ligen" | "pokalspiele";
}): Promise<LoadedLeagueClasses> {
    const { association, season, championship, competitionType } = params;

    return fetchWithFallback<LoadedLeagueClasses>({
        name: "league_hierarchy",
        // Die Seite hat einen eigenen Parser (Links), unabhängig vom JSON Format.
        fallbackOnFormatError: true,
        primary: async () => {
            const raw = await fetchMyttJson<LeagueHierarchyUpstream>(
                ["click-tt", association, season, competitionType, championship],
                {
                    _data: "routes/click-tt+/$association+/$season+/$type+/$championship"
                }
            );

            let normalized: ReturnType<typeof normalizeLeagueHierarchy>;

            try {
                normalized = normalizeLeagueHierarchy(
                    raw,
                    association,
                    season,
                    championship,
                    competitionType
                );
            } catch (error) {
                throw new UpstreamFormatError("league_hierarchy", [
                    error instanceof Error ? error.message : "unreadable hierarchy"
                ]);
            }

            if (normalized.classes.length === 0) {
                throw new UpstreamFormatError("league_hierarchy", ["no classes"]);
            }

            return normalized;
        },
        fallback: async () => {
            const html = await fetchMyttPage([
                "click-tt",
                association,
                season,
                competitionType,
                championship
            ]);

            const classes = extractLeagueClassLinks(
                html,
                association,
                season,
                championship,
                competitionType
            );

            return {
                sections: [
                    {
                        contest: null,
                        groups: classes
                    }
                ],
                classes,
                raw: null,
                strategy: "html" as const
            };
        }
    });
}
