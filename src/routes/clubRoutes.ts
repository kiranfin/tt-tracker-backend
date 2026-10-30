import type { FastifyInstance } from "fastify";
import { readThrough } from "../cache/index.js";
import { CACHE_TTL } from "../constants.js";
import {
    getClubHead,
    getClubInfo,
    getClubTeams
} from "../mytt/index.js";
import { readClubPlayers } from "../mytt/clubPlayersCache.js";
import { readClubSchedule } from "../mytt/cachedReads.js";
import { handleApiError } from "../utils/errors.js";
import { buildMeta } from "../utils/responseMeta.js";
import { getCurrentSeasonSegment, getDefaultSeasonDates } from "../utils/season.js";

const MAX_LOGO_BATCH = 30;
const CLUB_REF_PATTERN = /^[A-Za-z0-9-]{2,12}:\d{3,10}$/;

// Kopf (Logo) pro Verein, saisonunabhängig gecacht. Info Seite und Logo Endpoint teilen sich den Eintrag.
function readClubHead(organization: string, clubNumber: string, season = getCurrentSeasonSegment()) {
    return readThrough({
        key: `club-head:${organization}:${clubNumber}`,
        ttlMs: CACHE_TTL.CLUB_HEAD,
        load: () => getClubHead({ organization, clubNumber, season })
    });
}

export async function clubRoutes(app: FastifyInstance) {
    // Logos für mehrere Vereine auf einmal (Suche, Favoriten, Tabellen): ?clubs=TTBW:2055064,WTTV:12201
    // Antwort { "TTBW:2055064": url | null }. Fehlt ein Verein in der Antwort, ist der Abruf gescheitert
    // und die App darf es später erneut versuchen. null heißt: Verein hat kein Logo (oder ist unter dem Verband unbekannt).
    app.get("/api/clubs/logos", async (request, reply) => {
        const query = request.query as { clubs?: string };

        const refs = [
            ...new Set(
                (query.clubs ?? "")
                    .split(",")
                    .map((ref) => ref.trim())
                    .filter((ref) => CLUB_REF_PATTERN.test(ref))
                    .map((ref) => {
                        const [organization, clubNumber] = ref.split(":");
                        return `${organization.toUpperCase()}:${clubNumber}`;
                    })
            )
        ];

        if (refs.length === 0 || refs.length > MAX_LOGO_BATCH) {
            return reply.code(400).send({
                error: {
                    code: "INVALID_INPUT",
                    message: `clubs braucht 1 bis ${MAX_LOGO_BATCH} Einträge im Format VERBAND:VEREINSNUMMER.`
                }
            });
        }

        const results = await Promise.all(
            refs.map(async (ref) => {
                const [organization, clubNumber] = ref.split(":");

                try {
                    const result = await readClubHead(organization, clubNumber);
                    return [ref, result.value.logoUrl] as const;
                } catch (error) {
                    request.log.warn({ err: error, ref }, "Vereinslogo nicht geladen");
                    return null;
                }
            })
        );

        return {
            data: Object.fromEntries(results.filter((entry) => entry !== null))
        };
    });

    app.get("/api/clubs/:organization/:clubNumber/info", async (request, reply) => {
        const params = request.params as {
            organization?: string;
            clubNumber?: string;
        };

        const query = request.query as {
            season?: string;
            clubSlug?: string;
        };

        const organization = params.organization?.trim().toUpperCase() ?? "";
        const clubNumber = params.clubNumber?.trim() ?? "";
        const season = query.season?.trim().replace("/", "--") || getCurrentSeasonSegment();
        const clubSlug = query.clubSlug?.trim() || "x";

        if (!organization || !clubNumber || !/^\d{2}--\d{2}$/.test(season)) {
            return reply.code(400).send({
                error: {
                    code: "INVALID_INPUT",
                    message: "organization, clubNumber und eine gültige season sind erforderlich."
                }
            });
        }

        try {
            // Der Slug ändert die Daten nicht, deshalb nicht im Cache Key.
            const result = await readThrough({
                key: `club-info:${organization}:${clubNumber}:${season}`,
                ttlMs: CACHE_TTL.CLUB_INFO,
                load: () =>
                    getClubInfo(
                        {
                            organization,
                            clubNumber,
                            season,
                            clubSlug
                        },
                        async () => (await readClubHead(organization, clubNumber, season)).value
                    )
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

    app.get("/api/clubs/:organization/:clubNumber/teams", async (request, reply) => {
        const params = request.params as {
            organization?: string;
            clubNumber?: string;
        };

        const organization = params.organization?.trim().toUpperCase() ?? "";
        const clubNumber = params.clubNumber?.trim() ?? "";

        if (!organization || !clubNumber) {
            return reply.code(400).send({
                error: {
                    code: "INVALID_INPUT",
                    message: "organization und clubNumber sind erforderlich."
                }
            });
        }

        try {
            const result = await readThrough({
                key: `club-teams:${organization}:${clubNumber}`,
                ttlMs: CACHE_TTL.CLUB_TEAMS,
                load: () =>
                    getClubTeams({
                        organization,
                        clubNumber
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

    app.get("/api/clubs/:organization/:clubNumber/players", async (request, reply) => {
        const params = request.params as {
            organization?: string;
            clubNumber?: string;
        };

        const query = request.query as {
            androClubNr?: string;
            andro_club_nr?: string;
            clubName?: string;
            club_name?: string;
        };

        const organization = params.organization?.trim().toUpperCase() ?? "";
        const clubNumber = params.clubNumber?.trim() ?? "";

        const androClubNr =
            query.androClubNr?.trim() || query.andro_club_nr?.trim() || undefined;

        const clubName =
            query.clubName?.trim() || query.club_name?.trim() || undefined;

        if (!organization || !clubNumber) {
            return reply.code(400).send({
                error: {
                    code: "INVALID_INPUT",
                    message: "organization und clubNumber sind erforderlich."
                }
            });
        }

        try {
            const result = await readClubPlayers({
                organization,
                clubNumber,
                androClubNr,
                clubName
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

    app.get("/api/clubs/:organization/:clubNumber/schedule", async (request, reply) => {
        const params = request.params as {
            organization?: string;
            clubNumber?: string;
        };

        const query = request.query as {
            season?: string;
            clubSlug?: string;
            dateStart?: string;
            dateEnd?: string;
            date_start?: string;
            date_end?: string;
        };

        const organization = params.organization?.trim().toUpperCase() ?? "";
        const clubNumber = params.clubNumber?.trim() ?? "";
        const season = query.season?.trim() ?? "";
        const clubSlug = query.clubSlug?.trim() || "x";

        if (!organization || !clubNumber || !season) {
            return reply.code(400).send({
                error: {
                    code: "INVALID_INPUT",
                    message: "organization, clubNumber und season sind erforderlich."
                }
            });
        }

        const defaults = getDefaultSeasonDates(season);

        const dateStart =
            query.dateStart?.trim() ||
            query.date_start?.trim() ||
            defaults.dateStart;

        const dateEnd =
            query.dateEnd?.trim() ||
            query.date_end?.trim() ||
            defaults.dateEnd;

        try {
            const result = await readClubSchedule({
                organization,
                clubNumber,
                season,
                clubSlug,
                dateStart,
                dateEnd
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
}