import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { config } from "../config.js";
import { writeJsonLog } from "../fileLogger.js";
import { MailNotConfiguredError, sendAlertEmail } from "../mailer.js";
import { getJsonFromMytt } from "../mytt/request.js";
import { runInBackground } from "../upstream/priority.js";
import { fetchHtmlPage } from "../sources/html/fetchPage.js";
import { getRouteDataFromHtml, type JsonRecord } from "../sources/html/remixContext.js";
import { CANARY_PROBES, type CanaryProbe } from "./probes.js";

/**
 * Prüft regelmäßig feste Seiten einer alten Saison (Daten ändern sich nicht mehr). Pro Probe werden
 * JSON API und Webseite getrennt geholt und verglichen, beide gegen Schema und Plausibilitätsregeln
 * geprüft. Ein Unterschied heißt: myTischtennis hat das Format geändert, bevor Nutzer es merken.
 */

export type ProbeStatus = "ok" | "diverged" | "failed";

export type ProbeResult = {
    name: string;
    status: ProbeStatus;
    reasons: string[];
    durationMs: number;
    // Gespeicherte Seite, als Fixture für den Fix.
    snapshotFile?: string;
};

export type CanaryReport = {
    startedAt: string;
    finishedAt: string;
    status: "ok" | "problem";
    probes: ProbeResult[];
    alert: "sent" | "not_configured" | "failed" | "not_needed";
};

export type CanaryDeps = {
    probes: CanaryProbe[];
    fetchApi: (probe: CanaryProbe) => Promise<unknown>;
    fetchHtml: (probe: CanaryProbe) => Promise<string>;
    saveSnapshot: (probe: CanaryProbe, html: string) => Promise<string | undefined>;
    sendAlert: (subject: string, text: string) => Promise<void>;
    now: () => Date;
};

const MAX_DIFFS = 5;

function messageOf(error: unknown) {
    return error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
}

// Das Token in Download Links ist bei jedem Abruf anders.
function stripVolatile(value: unknown): unknown {
    if (typeof value === "string") {
        return value
            .replace(/([?&])historicalDataToken=[^&#\s"]*&?/g, "$1")
            .replace(/[?&]$/, "");
    }

    if (Array.isArray(value)) {
        return value.map(stripVolatile);
    }

    if (typeof value === "object" && value !== null) {
        return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [key, stripVolatile(entry)])
        );
    }

    return value;
}

/** Pfade, an denen zwei Werte abweichen (höchstens `limit`). */
export function diffPaths(left: unknown, right: unknown, limit = MAX_DIFFS, path = "$"): string[] {
    if (isDeepStrictEqual(left, right)) {
        return [];
    }

    if (Array.isArray(left) && Array.isArray(right)) {
        const diffs: string[] = [];

        if (left.length !== right.length) {
            diffs.push(`${path} (length ${left.length} vs ${right.length})`);
        }

        for (let index = 0; index < Math.min(left.length, right.length) && diffs.length < limit; index += 1) {
            diffs.push(...diffPaths(left[index], right[index], limit - diffs.length, `${path}[${index}]`));
        }

        return diffs.slice(0, limit);
    }

    if (
        typeof left === "object" && left !== null && !Array.isArray(left) &&
        typeof right === "object" && right !== null && !Array.isArray(right)
    ) {
        const a = left as Record<string, unknown>;
        const b = right as Record<string, unknown>;
        const diffs: string[] = [];

        for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
            if (diffs.length >= limit) {
                break;
            }

            if (!(key in a) || !(key in b)) {
                diffs.push(`${path}.${key} (only in ${key in a ? "API" : "page"})`);
            } else {
                diffs.push(...diffPaths(a[key], b[key], limit - diffs.length, `${path}.${key}`));
            }
        }

        return diffs.slice(0, limit);
    }

    return [path];
}

async function runProbe(
    probe: CanaryProbe,
    deps: CanaryDeps
): Promise<{ result: ProbeResult; html?: string }> {
    const startedAt = Date.now();
    const failures: string[] = [];
    const divergences: string[] = [];

    let api: unknown;
    let html: string | undefined;
    let routeData: JsonRecord | undefined;

    try {
        api = await deps.fetchApi(probe);
    } catch (error) {
        failures.push(`API: ${messageOf(error)}`);
    }

    try {
        html = await deps.fetchHtml(probe);
        routeData = getRouteDataFromHtml(html, probe.routeId);
    } catch (error) {
        failures.push(`Seite: ${messageOf(error)}`);
    }

    if (api !== undefined) {
        try {
            probe.check(api, `${probe.name}:api`);
        } catch (error) {
            failures.push(`API Daten: ${messageOf(error)}`);
        }
    }

    if (routeData) {
        try {
            probe.check(routeData, `${probe.name}:html`);
        } catch (error) {
            failures.push(`Seiten Daten: ${messageOf(error)}`);
        }
    }

    if (failures.length === 0 && api !== undefined && routeData && html) {
        const diffs = diffPaths(stripVolatile(api), stripVolatile(routeData));

        if (diffs.length > 0) {
            divergences.push(`API und Seite unterscheiden sich an: ${diffs.join(", ")}`);
        }

        try {
            divergences.push(...(probe.compareWithPage?.({ html, routeData }) ?? []));
        } catch (error) {
            failures.push(`Seitenvergleich: ${messageOf(error)}`);
        }
    }

    const status: ProbeStatus =
        failures.length > 0 ? "failed" : divergences.length > 0 ? "diverged" : "ok";

    return {
        result: {
            name: probe.name,
            status,
            reasons: [...failures, ...divergences],
            durationMs: Date.now() - startedAt
        },
        html
    };
}

function buildAlertText(report: CanaryReport) {
    const problems = report.probes.filter((probe) => probe.status !== "ok");

    return [
        "Der Canary Lauf hat Abweichungen bei myTischtennis gefunden.",
        "Vermutlich hat sich ein Datenformat geändert. Die App liefert bis dahin ggf. ältere Daten aus dem Cache.",
        "",
        ...problems.flatMap((probe) => [
            `${probe.name}: ${probe.status}`,
            ...probe.reasons.map((reason) => `  - ${reason}`),
            ...(probe.snapshotFile ? [`  Seite gespeichert: ${probe.snapshotFile}`] : []),
            ""
        ]),
        `Lauf: ${report.startedAt}`
    ].join("\n");
}

export function createCanary(deps: CanaryDeps) {
    let previous: "unknown" | "ok" | "problem" = "unknown";
    let last: CanaryReport | null = null;
    let running: Promise<CanaryReport> | null = null;

    async function execute(): Promise<CanaryReport> {
        const startedAt = deps.now().toISOString();
        const probes: ProbeResult[] = [];

        // Nacheinander: alle Requests laufen ohnehin durch den Throttle.
        for (const probe of deps.probes) {
            // Hintergrundarbeit: Nutzeranfragen gehen vor.
            const { result, html } = await runInBackground(() => runProbe(probe, deps));

            if (result.status !== "ok") {
                if (html) {
                    result.snapshotFile = await deps.saveSnapshot(probe, html).catch(() => undefined);
                }

                void writeJsonLog("canary_problem", {
                    probe: result.name,
                    status: result.status,
                    reasons: result.reasons,
                    snapshotFile: result.snapshotFile
                });
            }

            probes.push(result);
        }

        const status = probes.every((probe) => probe.status === "ok") ? "ok" : "problem";
        const report: CanaryReport = {
            startedAt,
            finishedAt: deps.now().toISOString(),
            status,
            probes,
            alert: "not_needed"
        };

        // Mail nur beim Wechsel auf Problem, nicht bei jedem Lauf.
        if (status === "problem" && previous !== "problem") {
            const problemCount = probes.filter((probe) => probe.status !== "ok").length;

            try {
                await deps.sendAlert(
                    `TT-Tracker: myTischtennis Format prüfen (${problemCount} Probe${problemCount === 1 ? "" : "n"})`,
                    buildAlertText(report)
                );
                report.alert = "sent";
                previous = "problem";
            } catch (error) {
                if (error instanceof MailNotConfiguredError) {
                    report.alert = "not_configured";
                    previous = "problem";
                } else {
                    // Mail ging nicht raus: beim nächsten Lauf erneut versuchen.
                    report.alert = "failed";
                    void writeJsonLog("canary_mail_failed", { errorMessage: messageOf(error) });
                }
            }
        } else {
            previous = status;
        }

        void writeJsonLog("canary_run", {
            status: report.status,
            alert: report.alert,
            probes: probes.map(({ name, status: probeStatus }) => ({ name, status: probeStatus }))
        });

        last = report;

        return report;
    }

    return {
        run(): Promise<CanaryReport> {
            running ??= execute().finally(() => {
                running = null;
            });

            return running;
        },
        lastReport: () => last
    };
}

const SNAPSHOT_DIR = resolve("data/canary");

const defaultDeps: CanaryDeps = {
    probes: CANARY_PROBES,
    fetchApi: (probe) =>
        getJsonFromMytt({
            name: probe.name,
            path: probe.path,
            searchParams: probe.searchParams,
            // Roh, ohne Schema: geprüft wird in der Probe.
            schema: { parse: (value) => value },
            extraHeaders: probe.extraHeaders
        }),
    fetchHtml: (probe) => {
        const searchParams = new URLSearchParams(probe.searchParams);
        searchParams.delete("_data");

        return fetchHtmlPage({ path: probe.path, searchParams });
    },
    saveSnapshot: async (probe, html) => {
        await mkdir(SNAPSHOT_DIR, { recursive: true });

        const file = resolve(SNAPSHOT_DIR, `${probe.name}-${new Date().toISOString().slice(0, 10)}.html`);

        await writeFile(file, html, "utf8");

        return file;
    },
    sendAlert: sendAlertEmail,
    now: () => new Date()
};

const canary = createCanary(defaultDeps);

export const runCanary = canary.run;
export const getLastCanaryReport = canary.lastReport;

/** Startet den regelmäßigen Lauf, wenn CANARY_INTERVAL_HOURS gesetzt ist. */
export function startCanarySchedule() {
    const { intervalHours } = config.canary;

    if (intervalHours <= 0) {
        return;
    }

    setInterval(() => {
        void runCanary().catch((error) => {
            void writeJsonLog("canary_error", { errorMessage: messageOf(error) });
        });
    }, intervalHours * 60 * 60 * 1000).unref();
}
