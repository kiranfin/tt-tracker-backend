import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
    ASSOCIATIONS,
    getLeagueClasses,
    getLeagueRegions,
    getLeagueScheduleData,
    getLeagueTableData,
    normalizeSeason,
    resolveAssociation,
    type LeagueRef,
    type RoundFilter
} from "../services/league.js";
import { handleApiError, sendInvalidInput } from "../utils/errors.js";

function queryValue(value: unknown): string {
    if (Array.isArray(value)) {
        return queryValue(value[0]);
    }

    return typeof value === "string" ? value.trim() : "";
}

function normalizeFilter(value: string | undefined): RoundFilter {
    return value === "vr" || value === "rr" || value === "gesamt" ? value : "gesamt";
}

async function sendRegionsResponse(
    request: FastifyRequest,
    reply: FastifyReply,
    associationValue: string,
    seasonValue?: string
) {
    const associationRef = resolveAssociation(associationValue);

    if (!associationRef) {
        return sendInvalidInput(reply, "association ist ungültig oder nicht unterstützt.");
    }

    try {
        const { value, meta } = await getLeagueRegions({
            association: associationRef.association,
            season: normalizeSeason(seasonValue)
        });

        return { data: value.regions, meta };
    } catch (error) {
        request.log.error(error);
        return handleApiError(error, reply);
    }
}

async function sendClassesResponse(
    request: FastifyRequest,
    reply: FastifyReply,
    associationValue: string,
    seasonValue: string | undefined,
    championshipValue: string,
    competitionTypeValue: string
) {
    const associationRef = resolveAssociation(associationValue);

    if (!associationRef) {
        return sendInvalidInput(reply, "association ist ungültig oder nicht unterstützt.");
    }

    const championship = championshipValue.trim();

    if (!championship) {
        return sendInvalidInput(
            reply,
            "championship ist erforderlich. Verwende den championshipSlug aus /api/leagues/:association/regions."
        );
    }

    try {
        const { value, meta } = await getLeagueClasses({
            association: associationRef.association,
            season: normalizeSeason(seasonValue),
            championship,
            competitionType: competitionTypeValue === "pokalspiele" ? "pokalspiele" : "ligen"
        });

        return { data: value.classes, sections: value.sections, meta };
    } catch (error) {
        request.log.error(error);
        return handleApiError(error, reply);
    }
}

/** Gemeinsame Eingaben von Tabelle und Spielplan einer Liga, oder null bei fehlenden Angaben. */
function parseLeagueRef(request: FastifyRequest): LeagueRef | null {
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

    if (!association || !season || !groupId) {
        return null;
    }

    return {
        association,
        season,
        groupId,
        leagueSlug: query.leagueSlug?.trim() || "x",
        filter: normalizeFilter(query.filter)
    };
}

export async function leagueRoutes(app: FastifyInstance) {
    app.get("/api/leagues/associations", async () => {
        return {
            data: ASSOCIATIONS,
            meta: {
                source: "static"
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
                    source: "static",
                    mode: "associations"
                }
            };
        }

        if (championship) {
            return sendClassesResponse(
                request,
                reply,
                regionOrAssociation,
                season,
                championship,
                competitionType
            );
        }

        return sendRegionsResponse(request, reply, regionOrAssociation, season);
    });

    app.get("/api/leagues/:association/regions", async (request, reply) => {
        const params = request.params as {
            association?: string;
        };

        const query = request.query as Record<string, unknown>;

        return sendRegionsResponse(
            request,
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
            request,
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
            request,
            reply,
            params.association ?? "",
            queryValue(query.season),
            queryValue(query.championship),
            queryValue(query.type)
        );
    });

    // /classes und /hierarchy liefern dasselbe, hierarchy ist der ältere Name.
    for (const name of ["classes", "hierarchy"]) {
        app.get(`/api/leagues/:association/:season/${name}`, async (request, reply) => {
            const params = request.params as {
                association?: string;
                season?: string;
            };

            const query = request.query as Record<string, unknown>;

            return sendClassesResponse(
                request,
                reply,
                params.association ?? "",
                params.season,
                queryValue(query.championship),
                queryValue(query.type)
            );
        });
    }

    app.get("/api/leagues/:association/:season/:groupId/table", async (request, reply) => {
        const league = parseLeagueRef(request);

        if (!league) {
            return sendInvalidInput(reply, "association, season und groupId sind erforderlich.");
        }

        try {
            const { value, meta } = await getLeagueTableData(league);

            return { data: value, meta };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });

    app.get("/api/leagues/:association/:season/:groupId/schedule", async (request, reply) => {
        const league = parseLeagueRef(request);

        if (!league) {
            return sendInvalidInput(reply, "association, season und groupId sind erforderlich.");
        }

        try {
            const { value, meta } = await getLeagueScheduleData(league);

            return { data: value, meta };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });
}
