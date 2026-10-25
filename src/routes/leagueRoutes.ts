import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { readThrough, type CacheSource } from "../cache/index.js";
import { CACHE_TTL } from "../constants.js";
import {
    ASSOCIATIONS,
    getLeagueSchedule,
    getLeagueTable,
    loadLeagueClasses,
    loadLeagueRegions,
    normalizeSeason,
    resolveAssociation
} from "../mytt/index.js";
import { handleApiError } from "../utils/errors.js";
import { buildMeta } from "../utils/responseMeta.js";

const LEAGUE_DISCOVERY_TTL = {
    ASSOCIATIONS: 24 * 60 * 60 * 1000,
    REGIONS: 6 * 60 * 60 * 1000,
    CLASSES: 60 * 60 * 1000
};

type ResponseSource = CacheSource | "static";

function queryValue(value: unknown): string {
    if (Array.isArray(value)) {
        return queryValue(value[0]);
    }

    return typeof value === "string" ? value.trim() : "";
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
    const result = await readThrough({
        key: cacheKey,
        ttlMs: LEAGUE_DISCOVERY_TTL.REGIONS,
        load: () => loadLeagueRegions(association, season)
    });

    return {
        data: result.value.regions,
        meta: {
            ...buildMeta(result),
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
    const result = await readThrough({
        key: cacheKey,
        ttlMs: LEAGUE_DISCOVERY_TTL.CLASSES,
        load: () =>
            loadLeagueClasses({
                association,
                season,
                championship,
                competitionType
            })
    });

    return {
        data: result.value.classes,
        sections: result.value.sections,
        meta: {
            ...buildMeta(result),
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
                source: "static" satisfies ResponseSource
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
                    source: "static" satisfies ResponseSource,
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

    app.get("/api/leagues/:association/:season/:groupId/table", async (request, reply) => {
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

        try {
            const result = await readThrough({
                key: `league-table:${association}:${season}:${groupId}:${leagueSlug}:${filter}`,
                ttlMs: CACHE_TTL.LEAGUE_TABLE,
                load: () =>
                    getLeagueTable({
                        association,
                        season,
                        groupId,
                        leagueSlug,
                        filter
                    })
            });

            return {
                data: result.value,
                meta: buildMeta(result)
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

            try {
                const result = await readThrough({
                    key: `league-schedule:${association}:${season}:${groupId}:${leagueSlug}:${filter}`,
                    ttlMs: CACHE_TTL.LEAGUE_SCHEDULE,
                    load: () =>
                        getLeagueSchedule({
                            association,
                            season,
                            groupId,
                            leagueSlug,
                            filter
                        })
                });

                return {
                    data: result.value,
                    meta: buildMeta(result)
                };
            } catch (error) {
                request.log.error(error);
                return handleApiError(error, reply);
            }
        }
    );
}