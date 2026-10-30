import type { FastifyInstance, FastifyRequest } from "fastify";
import {
    getTeamBalanceData,
    getTeamInfoData,
    getTeamPlayerList,
    getTeamScheduleData,
    getTeamSimpleScheduleData,
    type TeamRef
} from "../services/team.js";
import { handleApiError, sendInvalidInput } from "../utils/errors.js";

const DEFAULT_SEASON = "25--26";

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

function normalizeRequiredParam(value: string | undefined): string {
    return value?.trim() ?? "";
}

function normalizeSlug(value: string | undefined, fallback = "x"): string {
    const slug = value?.trim();

    return slug && slug.length > 0 ? slug : fallback;
}

/** Mannschaft aus Pfad und Query, oder null bei fehlenden Angaben. */
function parseTeamRef(request: FastifyRequest): TeamRef | null {
    const params = request.params as {
        association?: string;
        season?: string;
        groupId?: string;
        teamId?: string;
    };

    const query = request.query as Record<string, unknown>;

    const team = {
        association: params.association?.trim().toUpperCase() ?? "",
        season: normalizeSeason(params.season),
        groupId: normalizeRequiredParam(params.groupId),
        teamId: normalizeRequiredParam(params.teamId),
        leagueSlug: normalizeSlug(queryValue(query.leagueSlug)),
        teamNameSlug: normalizeSlug(queryValue(query.teamNameSlug))
    };

    return team.association && team.season && team.groupId && team.teamId ? team : null;
}

const TEAM_REF_ERROR = "association, season, groupId und teamId sind erforderlich.";

export async function teamRoutes(app: FastifyInstance) {
    app.get("/api/teams/:teamId/players", async (request, reply) => {
        const params = request.params as {
            teamId?: string;
        };

        const teamId = normalizeRequiredParam(params.teamId);

        if (!teamId) {
            return sendInvalidInput(reply, "teamId ist erforderlich.");
        }

        try {
            const { value, meta } = await getTeamPlayerList(teamId);

            return { data: value, meta };
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
            return sendInvalidInput(reply, "teamId ist erforderlich.");
        }

        try {
            const { value, meta } = await getTeamSimpleScheduleData(teamId, season);

            return { data: value, meta };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });

    app.get("/api/teams/:association/:season/:groupId/:teamId/infos", async (request, reply) => {
        const team = parseTeamRef(request);

        if (!team) {
            return sendInvalidInput(reply, TEAM_REF_ERROR);
        }

        try {
            const { value, meta } = await getTeamInfoData(team);

            return { data: value, meta };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });

    app.get("/api/teams/:association/:season/:groupId/:teamId/schedule", async (request, reply) => {
        const team = parseTeamRef(request);

        if (!team) {
            return sendInvalidInput(reply, TEAM_REF_ERROR);
        }

        const filter = normalizeFilter(queryValue((request.query as Record<string, unknown>).filter));

        try {
            const { value, meta } = await getTeamScheduleData(team, filter);

            return { data: value, meta };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });

    app.get("/api/teams/:association/:season/:groupId/:teamId/balances", async (request, reply) => {
        const team = parseTeamRef(request);

        if (!team) {
            return sendInvalidInput(reply, TEAM_REF_ERROR);
        }

        const filter = normalizeFilter(queryValue((request.query as Record<string, unknown>).filter));

        try {
            const { value, meta } = await getTeamBalanceData(team, filter);

            return { data: value, meta };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });
}
