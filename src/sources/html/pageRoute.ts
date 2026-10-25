import { fetchHtmlPage } from "./fetchPage.js";
import { getRouteDataFromHtml, type JsonRecord } from "./remixContext.js";

/**
 * Gegenstück zu `getJsonFromMytt` mit `?_data=<routeId>`: lädt die normale Seite und liest daraus
 * die eingebetteten Loader Daten der Route. Das Ergebnis hat dieselbe Form wie die JSON Antwort,
 * die bestehenden zod Schemas passen also direkt.
 */
export async function getRouteDataFromPage(params: {
    path: string;
    searchParams?: URLSearchParams;
    routeId: string;
}): Promise<{ routeData: JsonRecord; html: string }> {
    const searchParams = new URLSearchParams(params.searchParams);
    searchParams.delete("_data");

    const html = await fetchHtmlPage({
        path: params.path,
        searchParams
    });

    return {
        routeData: getRouteDataFromHtml(html, params.routeId),
        html
    };
}
