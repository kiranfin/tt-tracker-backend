import type { FastifyInstance } from "fastify";
import { getClubSearch, getPlayerSearch } from "../services/search.js";
import { handleApiError, sendInvalidInput } from "../utils/errors.js";

function parseSearchParams(query: {
    q?: string;
    page?: string;
    pagesize?: string;
}) {
    const q = query.q?.trim() ?? "";
    const page = Number(query.page ?? 1);
    const pagesize = Number(query.pagesize ?? 8);

    const safePage = Number.isFinite(page) && page > 0 ? page : 1;

    const safePagesize =
        Number.isFinite(pagesize) && pagesize > 0 && pagesize <= 20
            ? pagesize
            : 8;

    return {
        query: q,
        page: safePage,
        pagesize: safePagesize
    };
}

type SearchQuery = { q?: string; page?: string; pagesize?: string };

export async function searchRoutes(app: FastifyInstance) {
    app.get("/api/search/players", async (request, reply) => {
        const params = parseSearchParams(request.query as SearchQuery);

        if (params.query.length < 3) {
            return sendInvalidInput(reply, "Bitte mindestens 3 Zeichen eingeben.");
        }

        try {
            const { value, meta } = await getPlayerSearch(params, (error) =>
                request.log.error(error)
            );

            return { data: value, meta };
        } catch (error) {
            return handleApiError(error, reply);
        }
    });

    app.get("/api/search/clubs", async (request, reply) => {
        const params = parseSearchParams(request.query as SearchQuery);

        if (params.query.length < 3) {
            return sendInvalidInput(reply, "Bitte mindestens 3 Zeichen eingeben.");
        }

        try {
            const { value, meta } = await getClubSearch(params, (error) =>
                request.log.error(error)
            );

            return { data: value, meta };
        } catch (error) {
            return handleApiError(error, reply);
        }
    });
}
