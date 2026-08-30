import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";

import {
    EventDetailSchema,
    EventListResponseSchema,
    type EventDetail,
    type EventPrice,
    type EventSummary
} from "./schemas.js";
import { getRequestContext } from "./requestContext.js";
import { writeJsonLog } from "./fileLogger.js";
import {
    UpstreamDisabledError,
    UpstreamError
} from "./myttClient.js";

const DANCINGPARK_BASE_URL =
    process.env.DANCINGPARK_BASE_URL ?? "https://www.dancing-park.de";

const upstreamEnabled =
    process.env.DANCINGPARK_UPSTREAM_ENABLED !== "false";

// Politeness: a descriptive UA instead of spoofing a browser, plus a hard
// timeout so a slow upstream can never hang a backend request.
const USER_AGENT = "tt-tracker-backend (events proxy)";
const FETCH_TIMEOUT_MS = 10_000;

// Matches the GUIDs the site uses for event ids, e.g.
// 8B59E070-1B63-4129-91E6-B5DDB98098DC
const GUID_REGEX = /[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/;

// "Samstag, 29.08.2026 21:30 - 05:00(+1)"
const DATE_TEXT_REGEX =
    /(?<weekday>[A-Za-zäöüÄÖÜ]+)?[,\s]*(?<day>\d{2})\.(?<month>\d{2})\.(?<year>\d{4})(?:\s+(?<start>\d{1,2}:\d{2}))?(?:\s*-\s*(?<end>\d{1,2}:\d{2}))?(?<next>\(\+1\))?/;

async function fetchHtml(path: string): Promise<string> {
    if (!upstreamEnabled) {
        throw new UpstreamDisabledError();
    }

    const context = getRequestContext();
    const url = `${DANCINGPARK_BASE_URL}${path}`;
    const startedAt = Date.now();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            method: "GET",
            headers: {
                accept: "text/html",
                "user-agent": USER_AGENT
            },
            signal: controller.signal
        });

        void writeJsonLog("dancingpark_upstream_request", {
            requestId: context?.requestId,
            clientIp: context?.ip,
            backendMethod: context?.method,
            backendUrl: context?.url,
            upstreamMethod: "GET",
            upstreamPath: path,
            status: response.status,
            ok: response.ok,
            durationMs: Date.now() - startedAt
        });

        if (!response.ok) {
            throw new UpstreamError(
                `Dancing Park returned HTTP ${response.status}`
            );
        }

        return await response.text();
    } catch (error) {
        void writeJsonLog("dancingpark_upstream_error", {
            requestId: context?.requestId,
            upstreamPath: path,
            durationMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error)
        });

        if (
            error instanceof UpstreamError ||
            error instanceof UpstreamDisabledError
        ) {
            throw error;
        }

        // Network failure, abort/timeout, etc.
        throw new UpstreamError(
            `Dancing Park request failed for ${path}`
        );
    } finally {
        clearTimeout(timeout);
    }
}

function normalizeWhitespace(value: string | null | undefined): string {
    return (value ?? "").replace(/\s+/g, " ").trim();
}

function extractGuid(value: string | null | undefined): string | null {
    if (!value) return null;
    const match = value.match(GUID_REGEX);
    return match ? match[0] : null;
}

function buildDetailUrl(id: string): string {
    return `${DANCINGPARK_BASE_URL}/event/?id=${id}`;
}

type ParsedDate = {
    date: string | null;
    startTime: string | null;
    endTime: string | null;
    weekday: string | null;
    endsNextDay: boolean;
};

// Turns "Samstag, 29.08.2026 21:30 - 05:00(+1)" into structured fields.
// Purely string based; never throws, returns nulls on no match.
function parseGermanEventDate(raw: string): ParsedDate {
    const empty: ParsedDate = {
        date: null,
        startTime: null,
        endTime: null,
        weekday: null,
        endsNextDay: false
    };

    const match = raw.match(DATE_TEXT_REGEX);
    if (!match || !match.groups) {
        return empty;
    }

    const g = match.groups;

    return {
        date: g.day && g.month && g.year ? `${g.year}-${g.month}-${g.day}` : null,
        startTime: g.start ?? null,
        endTime: g.end ?? null,
        weekday: g.weekday ?? null,
        endsNextDay: Boolean(g.next)
    };
}

function parseEventItem($: CheerioAPI, item: Element): EventSummary | null {
    const $item = $(item);

    const detailHref = $item.find('a[href*="/event/?id="]').first().attr("href");
    const id = extractGuid(detailHref);

    if (!id) {
        // Without an id we can neither dedupe nor link the event – skip it.
        return null;
    }

    const title = normalizeWhitespace($item.find(".tickets-wide__title").text());
    const rawDateText = normalizeWhitespace($item.find(".tickets-wide__data").text());
    const parsedDate = parseGermanEventDate(rawDateText);

    const imageUrl = $item.find(".tickets-wide__img img").first().attr("src") ?? null;
    const reservationUrl =
        $item.find('a[href*="bookables-listing"]').first().attr("href") ?? null;
    const u18Url = $item.find('a[href*="u18-form"]').first().attr("href") ?? null;

    // The weekday is rendered in its own span; prefer it over the regex guess.
    const weekdaySpan = normalizeWhitespace(
        $item.find(".tickets-wide__data span").first().text()
    );

    return {
        id,
        title,
        date: parsedDate.date ?? "",
        startTime: parsedDate.startTime,
        endTime: parsedDate.endTime,
        endsNextDay: parsedDate.endsNextDay,
        weekday: weekdaySpan || parsedDate.weekday,
        rawDateText,
        imageUrl,
        detailUrl: buildDetailUrl(id),
        reservationUrl,
        u18Url
    };
}

export function parseEventsList(html: string): EventSummary[] {
    const $ = cheerio.load(html);

    let items = $('[data-neo-repeatable="Events"] .tickets-wide__item').toArray();

    if (items.length === 0) {
        // Fallback in case the repeatable wrapper markup changes.
        items = $(".tickets-wide__item").toArray();
    }

    const events: EventSummary[] = [];

    for (const item of items) {
        const parsed = parseEventItem($, item);
        if (parsed) {
            events.push(parsed);
        }
    }

    if (events.length === 0) {
        void writeJsonLog("dancingpark_parse_warning", {
            reason: "no_events_parsed",
            itemCount: items.length
        });
    }

    return events;
}

// Ticket prices are not exposed as structured data on the detail page – the
// only price signal lives inside the free-text description ("Tickets nur an der
// Abendkasse", occasional "€"/"VVK" lines). Best-effort: surface those lines.
const PRICE_KEYWORDS = /(€|\beur\b|eintritt|vvk|abendkasse|ticket|kasse|preis)/i;

function extractPrices(descriptionLines: string[]): EventPrice[] {
    const prices: EventPrice[] = [];

    for (const line of descriptionLines) {
        if (!PRICE_KEYWORDS.test(line)) {
            continue;
        }

        const [label, ...rest] = line.split(":");
        prices.push({
            label: normalizeWhitespace(label),
            value: normalizeWhitespace(rest.join(":"))
        });
    }

    return prices;
}

export function parseEventDetail(html: string, id: string): EventDetail {
    const $ = cheerio.load(html);

    const title = normalizeWhitespace($(".news-single__title").first().text());
    const imageUrl = $(".news-single__img img").first().attr("src") ?? null;
    const reservationUrl =
        $('a[href*="bookables-listing"]').first().attr("href") ?? null;
    const u18Url = $('a[href*="u18-form"]').first().attr("href") ?? null;

    // Description: the first <div> block after the action buttons holds the
    // rich-text body (one <div> per line).
    const descEl = $(".news-single__btn_").nextAll("div").first();
    const descriptionLines = descEl
        .children()
        .toArray()
        .map((el) => normalizeWhitespace($(el).text()))
        .filter(Boolean);

    const description = descriptionLines.length
        ? descriptionLines.join("\n")
        : normalizeWhitespace(descEl.text()) || null;

    // Date is repeated inside the structures block; pull the first match from
    // the whole page text.
    const parsedDate = parseGermanEventDate($("body").text());

    return {
        id,
        title,
        date: parsedDate.date ?? "",
        startTime: parsedDate.startTime,
        endTime: parsedDate.endTime,
        endsNextDay: parsedDate.endsNextDay,
        weekday: parsedDate.weekday,
        rawDateText: "",
        imageUrl,
        detailUrl: buildDetailUrl(id),
        reservationUrl,
        u18Url,
        description,
        prices: extractPrices(descriptionLines)
    };
}

export async function fetchEventsList(): Promise<EventSummary[]> {
    const html = await fetchHtml("/events-listing/");
    const events = parseEventsList(html);
    return EventListResponseSchema.parse(events);
}

export async function fetchEventDetail(id: string): Promise<EventDetail> {
    const html = await fetchHtml(`/event/?id=${id}`);
    const detail = parseEventDetail(html, id);
    return EventDetailSchema.parse(detail);
}
