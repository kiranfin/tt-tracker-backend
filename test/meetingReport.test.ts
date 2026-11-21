import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { MeetingLiveResponseSchema } from "../src/schemas.js";
import {
    buildMeetingReportPagePath,
    meetingReportToApiResponse,
    MEETING_REPORT_ROUTE_ID
} from "../src/sources/html/meetingReport.js";
import { getRouteDataFromHtml, RemixContextParseError } from "../src/sources/html/remixContext.js";
import { parseUpstream } from "../src/upstream/parse.js";

// Gekürzter Loader einer echten Spielbericht Seite (Landesliga TTBW, 2026-11-21)
const loaderData = JSON.parse(
    readFileSync(new URL("./fixtures/meeting-report-loader.json", import.meta.url), "utf8")
) as Record<string, unknown>;

function pageWithContext(data: unknown) {
    const context = JSON.stringify({ state: { loaderData: { root: {}, [MEETING_REPORT_ROUTE_ID]: data } } });

    return `<html><body><script>window.__remixContext = ${context};</script></body></html>`;
}

describe("meeting report page", () => {
    it("builds the page path from the meeting id alone", () => {
        assert.equal(
            buildMeetingReportPagePath("15944369"),
            "/click-tt/x/x/ligen/x/gruppe/x/spielbericht/15944369/x"
        );
        assert.equal(buildMeetingReportPagePath("a/b"), "/click-tt/x/x/ligen/x/gruppe/x/spielbericht/a%2Fb/x");
    });

    it("reads the report from the page and fits the API schema", () => {
        const routeData = getRouteDataFromHtml(pageWithContext(loaderData), MEETING_REPORT_ROUTE_ID);
        const response = parseUpstream(
            MeetingLiveResponseSchema,
            meetingReportToApiResponse(routeData),
            "meeting_live:html"
        );

        const meeting = response.data;

        assert.ok(meeting);
        assert.equal(meeting.live, false);
        assert.equal(meeting.is_completed, true);
        assert.equal(meeting.team_home, "TSG 1845 Heilbronn II");
        assert.equal(Number(meeting.matches_home), 9);
        assert.equal(Number(meeting.matches_guest), 2);
        assert.equal(meeting.match?.length, 2);
        assert.equal(meeting.match?.[0]?.mm_player11?.lastname, "Bieg");
        assert.equal(Number(meeting.match?.[0]?.set1_home), 12);
        assert.equal(Number(meeting.match?.[0]?.set1_guest), 10);
    });

    it("keeps fields beyond the schema (ids and league) for the app", () => {
        const response = meetingReportToApiResponse(loaderData);

        assert.equal(response.data.team_home_id, "3094063");
        assert.equal(response.data.group_id, "520588");
        assert.equal(response.data.team_home_club_fed_nickname, "TTBW");
    });

    it("rejects loader data without a report", () => {
        assert.throws(() => meetingReportToApiResponse({ meetingId: "1" }), RemixContextParseError);
        assert.throws(() => meetingReportToApiResponse({ meetingReport: [] }), RemixContextParseError);
    });
});

describe("getMeetingLive fallback", () => {
    it("reads the report from the page when the API answers with a server error", async () => {
        const { getMeetingLive } = await import("../src/mytt/meeting.js");
        const { runWithLoadOrigin } = await import("../src/cache/loadOrigin.js");
        const { resetBreakersForTests } = await import("../src/upstream/rateLimiter.js");

        resetBreakersForTests();

        const originalFetch = globalThis.fetch;
        const requested: string[] = [];

        globalThis.fetch = (async (input: string | URL | Request) => {
            const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);

            requested.push(url.pathname);

            if (url.pathname.startsWith("/api/meeting/")) {
                return new Response("{}", { status: 503 });
            }

            return new Response(pageWithContext(loaderData), {
                status: 200,
                headers: { "content-type": "text/html; charset=utf-8" }
            });
        }) as typeof fetch;

        try {
            const { value, origin } = await runWithLoadOrigin(() => getMeetingLive({ meetingId: "15944369" }));

            assert.equal(origin, "html");
            assert.equal(value.data?.team_home, "TSG 1845 Heilbronn II");
            assert.deepEqual(requested, [
                "/api/meeting/15944369/live",
                "/click-tt/x/x/ligen/x/gruppe/x/spielbericht/15944369/x"
            ]);
        } finally {
            globalThis.fetch = originalFetch;
            resetBreakersForTests();
        }
    });
});
