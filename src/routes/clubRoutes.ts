import type { FastifyInstance } from "fastify";
import {
    getClubInfoData,
    getClubLogos,
    getClubPlayerList,
    getClubScheduleData,
    getClubTeamList
} from "../services/club.js";
import { handleApiError, sendInvalidInput } from "../utils/errors.js";
import { getCurrentSeasonSegment, getDefaultSeasonDates } from "../utils/season.js";

const MAX_LOGO_BATCH = 30;
const CLUB_REF_PATTERN = /^[A-Za-z0-9-]{2,12}:\d{3,10}$/;

type ClubParams = {
    organization?: string;
    clubNumber?: string;
};

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
            return sendInvalidInput(
                reply,
                `clubs braucht 1 bis ${MAX_LOGO_BATCH} Einträge im Format VERBAND:VEREINSNUMMER.`
            );
        }

        const logos = await getClubLogos(refs, (error, ref) =>
            request.log.warn({ err: error, ref }, "Vereinslogo nicht geladen")
        );

        return { data: logos };
    });

    app.get("/api/clubs/:organization/:clubNumber/info", async (request, reply) => {
        const params = request.params as ClubParams;

        const query = request.query as {
            season?: string;
            clubSlug?: string;
        };

        const organization = params.organization?.trim().toUpperCase() ?? "";
        const clubNumber = params.clubNumber?.trim() ?? "";
        const season = query.season?.trim().replace("/", "--") || getCurrentSeasonSegment();
        const clubSlug = query.clubSlug?.trim() || "x";

        if (!organization || !clubNumber || !/^\d{2}--\d{2}$/.test(season)) {
            return sendInvalidInput(
                reply,
                "organization, clubNumber und eine gültige season sind erforderlich."
            );
        }

        try {
            const { value, meta } = await getClubInfoData({
                organization,
                clubNumber,
                season,
                clubSlug
            });

            return { data: value, meta };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });

    app.get("/api/clubs/:organization/:clubNumber/teams", async (request, reply) => {
        const params = request.params as ClubParams;

        const organization = params.organization?.trim().toUpperCase() ?? "";
        const clubNumber = params.clubNumber?.trim() ?? "";

        if (!organization || !clubNumber) {
            return sendInvalidInput(reply, "organization und clubNumber sind erforderlich.");
        }

        try {
            const { value, meta } = await getClubTeamList({ organization, clubNumber });

            return { data: value, meta };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });

    app.get("/api/clubs/:organization/:clubNumber/players", async (request, reply) => {
        const params = request.params as ClubParams;

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
            return sendInvalidInput(reply, "organization und clubNumber sind erforderlich.");
        }

        try {
            const { value, meta } = await getClubPlayerList({
                organization,
                clubNumber,
                androClubNr,
                clubName
            });

            return { data: value, meta };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });

    app.get("/api/clubs/:organization/:clubNumber/schedule", async (request, reply) => {
        const params = request.params as ClubParams;

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
            return sendInvalidInput(
                reply,
                "organization, clubNumber und season sind erforderlich."
            );
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
            const { value, meta } = await getClubScheduleData({
                organization,
                clubNumber,
                season,
                clubSlug,
                dateStart,
                dateEnd
            });

            return { data: value, meta };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });
}
