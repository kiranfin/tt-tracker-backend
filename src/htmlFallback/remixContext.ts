export class RemixContextParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "RemixContextParseError";
    }
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseRemixContextFromHtml(html: string): JsonRecord {
    const marker = "window.__remixContext = ";
    const start = html.indexOf(marker);

    if (start < 0) {
        throw new RemixContextParseError("window.__remixContext was not found in HTML.");
    }

    const jsonStart = start + marker.length;
    const jsonEnd = html.indexOf(";</script>", jsonStart);

    if (jsonEnd < 0) {
        throw new RemixContextParseError("Could not find end of window.__remixContext script.");
    }

    const rawJson = html.slice(jsonStart, jsonEnd).trim();

    try {
        const parsed: unknown = JSON.parse(rawJson);

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

export function getRemixRouteData(params: {
    loaderData: JsonRecord;
    routeKeySuffix: string;
}): JsonRecord {
    const match = Object.entries(params.loaderData).find(([routeKey]) =>
        routeKey.endsWith(params.routeKeySuffix)
    );

    if (!match) {
        throw new RemixContextParseError(
            `Could not find Remix loaderData route ending with "${params.routeKeySuffix}".`
        );
    }

    const [, value] = match;

    if (!isRecord(value)) {
        throw new RemixContextParseError("Matched Remix route data is not an object.");
    }

    return value;
}