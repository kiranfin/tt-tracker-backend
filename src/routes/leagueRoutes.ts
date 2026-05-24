import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getFromCache, setCache } from "../cache.js";
import { CACHE_TTL } from "../constants.js";
import { getLeagueSchedule, getLeagueTable } from "../myttClient.js";
import type {
    LeagueScheduleResponse,
    LeagueTableResponse
} from "../schemas.js";
import { handleApiError } from "../utils/errors.js";

const MYTT_BASE_URL = "https://www.mytischtennis.de";
const DEFAULT_SEASON = "25--26";

const LEAGUE_DISCOVERY_TTL = {
    ASSOCIATIONS: 24 * 60 * 60 * 1000,
    REGIONS: 6 * 60 * 60 * 1000,
    CLASSES: 60 * 60 * 1000
};

type CacheSource = "cache" | "upstream" | "static";

type AssociationReference = {
    id: string;
    association: string;
    shortName: string;
    name: string;
    androPattern: string | null;
};

type RegionReference = {
    id: string;
    name: string;
    association: string;
    season: string;
    championshipSlug: string;
    type: "association" | "region";
};

type LeagueClassReference = {
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

const ASSOCIATIONS: AssociationReference[] = [
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

function queryValue(value: unknown): string {
    if (Array.isArray(value)) {
        return queryValue(value[0]);
    }

    return typeof value === "string" ? value.trim() : "";
}

function normalizeSearchValue(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/&/g, "und")
        .replace(/[^a-z0-9]+/g, "");
}

function normalizeSeason(value: string | undefined | null): string {
    const season = value?.trim();

    if (!season) {
        return DEFAULT_SEASON;
    }

    return season.replace(/\//g, "--");
}

function resolveAssociation(value: string): AssociationReference | null {
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

function buildMyttUrl(
    pathSegments: string[],
    query?: Record<string, string | undefined>
): URL {
    const path = `/${pathSegments
        .map((segment) => encodeURIComponent(segment))
        .join("/")}`;

    const url = new URL(path, MYTT_BASE_URL);

    for (const [key, value] of Object.entries(query ?? {})) {
        if (value !== undefined && value !== "") {
            url.searchParams.set(key, value);
        }
    }

    return url;
}

async function fetchTextFromMytt(
    pathSegments: string[],
    query?: Record<string, string | undefined>
): Promise<string> {
    const url = buildMyttUrl(pathSegments, query);

    const response = await fetch(url, {
        headers: {
            accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
            "user-agent": "Mozilla/5.0 (compatible; TischtennisTracker/1.0)"
        }
    });

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
            `myTischtennis request failed: ${response.status} ${response.statusText} ${body.slice(0, 200)}`
        );
    }

    return response.text();
}

async function fetchJsonFromMytt<T>(
    pathSegments: string[],
    query?: Record<string, string | undefined>
): Promise<T> {
    const url = buildMyttUrl(pathSegments, query);

    const response = await fetch(url, {
        headers: {
            accept: "application/json,text/plain,*/*",
            "user-agent": "Mozilla/5.0 (compatible; TischtennisTracker/1.0)"
        }
    });

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
            `myTischtennis request failed: ${response.status} ${response.statusText} ${body.slice(0, 200)}`
        );
    }

    return response.json() as Promise<T>;
}

async function readThroughCache<T>(
    cacheKey: string,
    ttlMs: number,
    load: () => Promise<T>
): Promise<{ value: T; source: CacheSource }> {
    const cached = getFromCache<T>(cacheKey);

    if (cached) {
        return {
            value: cached,
            source: "cache"
        };
    }

    const value = await load();
    setCache(cacheKey, value, ttlMs);

    return {
        value,
        source: "upstream"
    };
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

async function loadLeagueRegions(
    association: string,
    season: string
): Promise<{
    association: string;
    season: string;
    regions: RegionReference[];
}> {
    const html = await fetchTextFromMytt([
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

async function loadLeagueClasses(params: {
    association: string;
    season: string;
    championship: string;
    competitionType: "ligen" | "pokalspiele";
}): Promise<{
    sections: Array<{
        contest: string | null;
        groups: LeagueClassReference[];
    }>;
    classes: LeagueClassReference[];
    raw: LeagueHierarchyUpstream | null;
    strategy: "json" | "html";
}> {
    const { association, season, championship, competitionType } = params;

    try {
        const raw = await fetchJsonFromMytt<LeagueHierarchyUpstream>(
            ["click-tt", association, season, competitionType, championship],
            {
                _data: "routes/click-tt+/$association+/$season+/$type+/$championship"
            }
        );

        const normalized = normalizeLeagueHierarchy(
            raw,
            association,
            season,
            championship,
            competitionType
        );

        if (normalized.classes.length > 0) {
            return normalized;
        }
    } catch {
        // Fallback auf HTML darunter.
    }

    const html = await fetchTextFromMytt([
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
        strategy: "html"
    };
}

async function sendRegionsResponse(
    reply: FastifyReply,
    associationValue: string,
    seasonValue?: string
) {
    const associationRef = resolveAssociation(associationValue);

    if (!associationRef) {
        return reply.code(400).send({
            error: {
                code: "INVALID_INPUT",
                message: "association ist ungültig oder nicht unterstützt."
            }
        });
    }

    const association = associationRef.association;
    const season = normalizeSeason(seasonValue);

    const cacheKey = `league-regions:${association}:${season}`;
    const result = await readThroughCache(
        cacheKey,
        LEAGUE_DISCOVERY_TTL.REGIONS,
        () => loadLeagueRegions(association, season)
    );

    return {
        data: result.value.regions,
        meta: {
            source: result.source,
            association,
            season
        }
    };
}

async function sendClassesResponse(
    reply: FastifyReply,
    associationValue: string,
    seasonValue: string | undefined,
    championshipValue: string,
    competitionTypeValue: string
) {
    const associationRef = resolveAssociation(associationValue);

    if (!associationRef) {
        return reply.code(400).send({
            error: {
                code: "INVALID_INPUT",
                message: "association ist ungültig oder nicht unterstützt."
            }
        });
    }

    const association = associationRef.association;
    const season = normalizeSeason(seasonValue);
    const championship = championshipValue.trim();

    const competitionType =
        competitionTypeValue === "pokalspiele" ? "pokalspiele" : "ligen";

    if (!championship) {
        return reply.code(400).send({
            error: {
                code: "INVALID_INPUT",
                message: "championship ist erforderlich. Verwende den championshipSlug aus /api/leagues/:association/regions."
            }
        });
    }

    const cacheKey = `league-classes:${association}:${season}:${competitionType}:${championship}`;
    const result = await readThroughCache(
        cacheKey,
        LEAGUE_DISCOVERY_TTL.CLASSES,
        () =>
            loadLeagueClasses({
                association,
                season,
                championship,
                competitionType
            })
    );

    return {
        data: result.value.classes,
        sections: result.value.sections,
        meta: {
            source: result.source,
            association,
            season,
            championship,
            competitionType,
            strategy: result.value.strategy
        }
    };
}

export async function leagueRoutes(app: FastifyInstance) {
    app.get("/api/leagues/associations", async () => {
        return {
            data: ASSOCIATIONS,
            meta: {
                source: "static" satisfies CacheSource
            }
        };
    });

    app.get("/api/leagues", async (request: FastifyRequest, reply) => {
        const query = request.query as Record<string, unknown>;

        const regionOrAssociation =
            queryValue(query.association) || queryValue(query.region);

        const championship = queryValue(query.championship);
        const season = normalizeSeason(queryValue(query.season));
        const competitionType = queryValue(query.type);

        if (!regionOrAssociation) {
            return {
                data: ASSOCIATIONS,
                meta: {
                    source: "static" satisfies CacheSource,
                    mode: "associations"
                }
            };
        }

        if (championship) {
            return sendClassesResponse(
                reply,
                regionOrAssociation,
                season,
                championship,
                competitionType
            );
        }

        return sendRegionsResponse(reply, regionOrAssociation, season);
    });

    app.get("/api/leagues/:association/regions", async (request, reply) => {
        const params = request.params as {
            association?: string;
        };

        const query = request.query as Record<string, unknown>;

        return sendRegionsResponse(
            reply,
            params.association ?? "",
            queryValue(query.season)
        );
    });

    app.get("/api/leagues/:association/:season/regions", async (request, reply) => {
        const params = request.params as {
            association?: string;
            season?: string;
        };

        return sendRegionsResponse(
            reply,
            params.association ?? "",
            params.season
        );
    });

    app.get("/api/leagues/:association/classes", async (request, reply) => {
        const params = request.params as {
            association?: string;
        };

        const query = request.query as Record<string, unknown>;

        return sendClassesResponse(
            reply,
            params.association ?? "",
            queryValue(query.season),
            queryValue(query.championship),
            queryValue(query.type)
        );
    });

    app.get("/api/leagues/:association/:season/classes", async (request, reply) => {
        const params = request.params as {
            association?: string;
            season?: string;
        };

        const query = request.query as Record<string, unknown>;

        return sendClassesResponse(
            reply,
            params.association ?? "",
            params.season,
            queryValue(query.championship),
            queryValue(query.type)
        );
    });

    app.get("/api/leagues/:association/:season/hierarchy", async (request, reply) => {
        const params = request.params as {
            association?: string;
            season?: string;
        };

        const query = request.query as Record<string, unknown>;

        return sendClassesResponse(
            reply,
            params.association ?? "",
            params.season,
            queryValue(query.championship),
            queryValue(query.type)
        );
    });

    app.get("/api/leagues/:association/:groupId/table", async (request, reply) => {
        const params = request.params as {
            association?: string;
            groupId?: string;
        };

        const association = params.association?.trim().toUpperCase() ?? "";
        const groupId = params.groupId?.trim() ?? "";

        if (!association || !groupId) {
            return reply.code(400).send({
                error: {
                    code: "INVALID_INPUT",
                    message: "association und groupId sind erforderlich."
                }
            });
        }

        const cacheKey = `league-table:${association}:${groupId}`;
        const cached = getFromCache<LeagueTableResponse>(cacheKey);

        if (cached) {
            return {
                data: cached,
                meta: {
                    source: "cache"
                }
            };
        }

        try {
            const result = await getLeagueTable({
                association,
                groupId
            });

            setCache(cacheKey, result, CACHE_TTL.LEAGUE_TABLE);

            return {
                data: result,
                meta: {
                    source: "upstream"
                }
            };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });

    app.get(
        "/api/leagues/:association/:season/:groupId/schedule",
        async (request, reply) => {
            const params = request.params as {
                association?: string;
                season?: string;
                groupId?: string;
            };

            const query = request.query as {
                leagueSlug?: string;
                filter?: string;
            };

            const association = params.association?.trim().toUpperCase() ?? "";
            const season = normalizeSeason(params.season);
            const groupId = params.groupId?.trim() ?? "";
            const leagueSlug = query.leagueSlug?.trim() || "x";

            const filter =
                query.filter === "vr" ||
                query.filter === "rr" ||
                query.filter === "gesamt"
                    ? query.filter
                    : "gesamt";

            if (!association || !season || !groupId) {
                return reply.code(400).send({
                    error: {
                        code: "INVALID_INPUT",
                        message: "association, season und groupId sind erforderlich."
                    }
                });
            }

            const cacheKey = `league-schedule:${association}:${season}:${groupId}:${leagueSlug}:${filter}`;
            const cached = getFromCache<LeagueScheduleResponse>(cacheKey);

            if (cached) {
                return {
                    data: cached,
                    meta: {
                        source: "cache"
                    }
                };
            }

            try {
                const result = await getLeagueSchedule({
                    association,
                    season,
                    groupId,
                    leagueSlug,
                    filter
                });

                setCache(cacheKey, result, CACHE_TTL.LEAGUE_SCHEDULE);

                return {
                    data: result,
                    meta: {
                        source: "upstream"
                    }
                };
            } catch (error) {
                request.log.error(error);
                return handleApiError(error, reply);
            }
        }
    );
}