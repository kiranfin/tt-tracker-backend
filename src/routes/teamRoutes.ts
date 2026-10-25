import type { FastifyInstance } from "fastify";
import { readThrough } from "../cache.js";
import {
    getTeamBalances,
    getTeamInfos,
    getTeamPlayers,
    getTeamSchedule,
    getTeamSimpleSchedule
} from "../myttClient.js";
import { handleApiError } from "../utils/errors.js";
import { buildMeta } from "../utils/responseMeta.js";

const DEFAULT_SEASON = "25--26";

const TEAM_CACHE_TTL = {
    PLAYERS: 10 * 60 * 1000,
    SIMPLE_SCHEDULE: 5 * 60 * 1000,
    INFOS: 15 * 60 * 1000,
    SCHEDULE: 5 * 60 * 1000,
    BALANCES: 5 * 60 * 1000
};

type RoundFilter = "gesamt" | "vr" | "rr";

function queryValue(value: unknown): string {
    if (Array.isArray(value)) {
        return queryValue(value[0]);
    }

    return typeof value === "string" ? value.trim() : "";
}

function normalizeSeason(value: string | undefined | null): string {
    const season = value?.trim();

    if (!season) {
        return DEFAULT_SEASON;
    }

    return season.replace(/\//g, "--");
}

function normalizeFilter(value: string | undefined): RoundFilter {
    if (value === "vr" || value === "rr" || value === "gesamt") {
        return value;
    }

    return "gesamt";
}

function normalizeAssociation(value: string | undefined): string {
    return value?.trim().toUpperCase() ?? "";
}

function normalizeRequiredParam(value: string | undefined): string {
    return value?.trim() ?? "";
}

function normalizeSlug(value: string | undefined, fallback = "x"): string {
    const slug = value?.trim();

    return slug && slug.length > 0 ? slug : fallback;
}

export async function teamRoutes(app: FastifyInstance) {
    app.get("/api/teams/:teamId/players", async (request, reply) => {
        const params = request.params as {
            teamId?: string;
        };

        const teamId = normalizeRequiredParam(params.teamId);

        if (!teamId) {
            return reply.code(400).send({
                error: {
                    code: "INVALID_INPUT",
                    message: "teamId ist erforderlich."
                }
            });
        }

        try {
            const result = await readThrough({
                key: `team-players:${teamId}`,
                ttlMs: TEAM_CACHE_TTL.PLAYERS,
                load: () =>
                    getTeamPlayers({ teamId })
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

    app.get("/api/teams/:teamId/simple-schedule", async (request, reply) => {
        const params = request.params as {
            teamId?: string;
        };

        const query = request.query as Record<string, unknown>;

        const teamId = normalizeRequiredParam(params.teamId);
        const season = normalizeSeason(queryValue(query.season));

        if (!teamId) {
            return reply.code(400).send({
                error: {
                    code: "INVALID_INPUT",
                    message: "teamId ist erforderlich."
                }
            });
        }

        try {
            const result = await readThrough({
                key: `team-simple-schedule:${teamId}:${season}`,
                ttlMs: TEAM_CACHE_TTL.SIMPLE_SCHEDULE,
                load: () =>
                    getTeamSimpleSchedule({ teamId, season })
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
        "/api/teams/:association/:season/:groupId/:teamId/infos",
        async (request, reply) => {
            const params = request.params as {
                association?: string;
                season?: string;
                groupId?: string;
                teamId?: string;
            };

            const query = request.query as Record<string, unknown>;

            const association = normalizeAssociation(params.association);
            const season = normalizeSeason(params.season);
            const groupId = normalizeRequiredParam(params.groupId);
            const teamId = normalizeRequiredParam(params.teamId);
            const leagueSlug = normalizeSlug(queryValue(query.leagueSlug));
            const teamNameSlug = normalizeSlug(queryValue(query.teamNameSlug));

            if (!association || !season || !groupId || !teamId) {
                return reply.code(400).send({
                    error: {
                        code: "INVALID_INPUT",
                        message: "association, season, groupId und teamId sind erforderlich."
                    }
                });
            }

            try {
                const result = await readThrough({
                    key: `team-infos:${association}:${season}:${groupId}:${leagueSlug}:${teamId}:${teamNameSlug}`,
                    ttlMs: TEAM_CACHE_TTL.INFOS,
                    load: () =>
                        getTeamInfos({
                            association,
                            season,
                            groupId,
                            leagueSlug,
                            teamId,
                            teamNameSlug
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

    app.get(
        "/api/teams/:association/:season/:groupId/:teamId/schedule",
        async (request, reply) => {
            const params = request.params as {
                association?: string;
                season?: string;
                groupId?: string;
                teamId?: string;
            };

            const query = request.query as Record<string, unknown>;

            const association = normalizeAssociation(params.association);
            const season = normalizeSeason(params.season);
            const groupId = normalizeRequiredParam(params.groupId);
            const teamId = normalizeRequiredParam(params.teamId);
            const leagueSlug = normalizeSlug(queryValue(query.leagueSlug));
            const teamNameSlug = normalizeSlug(queryValue(query.teamNameSlug));
            const filter = normalizeFilter(queryValue(query.filter));

            if (!association || !season || !groupId || !teamId) {
                return reply.code(400).send({
                    error: {
                        code: "INVALID_INPUT",
                        message: "association, season, groupId und teamId sind erforderlich."
                    }
                });
            }

            try {
                const result = await readThrough({
                    key: `team-schedule:${association}:${season}:${groupId}:${leagueSlug}:${teamId}:${teamNameSlug}:${filter}`,
                    ttlMs: TEAM_CACHE_TTL.SCHEDULE,
                    load: () =>
                        getTeamSchedule({
                            association,
                            season,
                            groupId,
                            leagueSlug,
                            teamId,
                            teamNameSlug,
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

    app.get(
        "/api/teams/:association/:season/:groupId/:teamId/balances",
        async (request, reply) => {
            const params = request.params as {
                association?: string;
                season?: string;
                groupId?: string;
                teamId?: string;
            };

            const query = request.query as Record<string, unknown>;

            const association = normalizeAssociation(params.association);
            const season = normalizeSeason(params.season);
            const groupId = normalizeRequiredParam(params.groupId);
            const teamId = normalizeRequiredParam(params.teamId);
            const leagueSlug = normalizeSlug(queryValue(query.leagueSlug));
            const teamNameSlug = normalizeSlug(queryValue(query.teamNameSlug));
            const filter = normalizeFilter(queryValue(query.filter));

            if (!association || !season || !groupId || !teamId) {
                return reply.code(400).send({
                    error: {
                        code: "INVALID_INPUT",
                        message: "association, season, groupId und teamId sind erforderlich."
                    }
                });
            }

            try {
                const result = await readThrough({
                    key: `team-balances:${association}:${season}:${groupId}:${leagueSlug}:${teamId}:${teamNameSlug}:${filter}`,
                    ttlMs: TEAM_CACHE_TTL.BALANCES,
                    load: () =>
                        getTeamBalances({
                            association,
                            season,
                            groupId,
                            leagueSlug,
                            teamId,
                            teamNameSlug,
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