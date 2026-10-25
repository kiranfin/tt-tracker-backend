export class RemixContextParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "RemixContextParseError";
    }
}

export type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

const REMIX_MARKER = "window.__remixContext = ";
const REACT_ROUTER_MARKER = "window.__reactRouterContext";

export function parseRemixContextFromHtml(html: string): JsonRecord {
    const start = html.indexOf(REMIX_MARKER);

    if (start < 0) {
        // React Router 7 liefert die Loader Daten als turbo-stream statt als JSON.
        // Das wird hier erkannt, damit das Log den Grund für den Ausfall nennt.
        if (html.includes(REACT_ROUTER_MARKER)) {
            throw new RemixContextParseError(
                "Page uses window.__reactRouterContext (React Router 7 turbo-stream), which is not supported yet."
            );
        }

        throw new RemixContextParseError("window.__remixContext was not found in HTML.");
    }

    const jsonStart = start + REMIX_MARKER.length;
    const jsonEnd = html.indexOf(";</script>", jsonStart);

    if (jsonEnd < 0) {
        throw new RemixContextParseError("Could not find end of window.__remixContext script.");
    }

    try {
        const parsed: unknown = JSON.parse(html.slice(jsonStart, jsonEnd).trim());

        if (!isRecord(parsed)) {
            throw new RemixContextParseError("window.__remixContext is not an object.");
        }

        return parsed;
    } catch (error) {
        if (error instanceof RemixContextParseError) {
            throw error;
        }

        throw new RemixContextParseError(
            error instanceof Error
                ? `Could not parse window.__remixContext JSON: ${error.message}`
                : "Could not parse window.__remixContext JSON."
        );
    }
}

export function getRemixLoaderData(context: JsonRecord): JsonRecord {
    const state = context.state;

    if (!isRecord(state)) {
        throw new RemixContextParseError("window.__remixContext.state is missing.");
    }

    const loaderData = state.loaderData;

    if (!isRecord(loaderData)) {
        throw new RemixContextParseError("window.__remixContext.state.loaderData is missing.");
    }

    return loaderData;
}

/**
 * Liefert die Loader Daten einer Route. `routeId` ist derselbe Wert, den `?_data=` erwartet,
 * z.B. "routes/click-tt+/$association+/$season+/$type+/$groupname.gruppe.$urlid+/tabelle.$filter".
 * Fallback: nur das letzte Segment ("/tabelle.$filter"), falls sich der Pfad davor ändert.
 */
export function getRemixRouteData(params: {
    loaderData: JsonRecord;
    routeId: string;
}): JsonRecord {
    const exact = params.loaderData[params.routeId];

    if (isRecord(exact)) {
        return exact;
    }

    const lastSegment = params.routeId.slice(params.routeId.lastIndexOf("/"));
    const matches = Object.entries(params.loaderData).filter(([routeKey]) =>
        routeKey.endsWith(lastSegment)
    );

    if (matches.length === 1 && isRecord(matches[0][1])) {
        return matches[0][1];
    }

    throw new RemixContextParseError(
        `Could not find Remix loaderData for route "${params.routeId}".`
    );
}

export function getRouteDataFromHtml(html: string, routeId: string): JsonRecord {
    return getRemixRouteData({
        loaderData: getRemixLoaderData(parseRemixContextFromHtml(html)),
        routeId
    });
}
