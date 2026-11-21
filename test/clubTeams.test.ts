import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CLUB_LINEUP_ROUTE_ID, CLUB_TEAMS_ROUTE_ID } from "../src/mytt/club.js";
import {
    buildTeamInfosPagePath,
    pickLineup,
    TEAM_INFOS_ROUTE_ID,
    type ClubLineupRef
} from "../src/mytt/team.js";
import { ClubTeamsResponseSchema, TeamPlayersResponseSchema, type ClubTeamsResponse } from "../src/schemas.js";
import { clubTeamsPageToApiResponse, teamLineupToApiResponse } from "../src/sources/html/clubTeams.js";
import { RemixContextParseError, type JsonRecord } from "../src/sources/html/remixContext.js";
import { RelayRequiredError, UpstreamError } from "../src/upstream/errors.js";
import { parseUpstream } from "../src/upstream/parse.js";

// Aufgebaut wie die echten Loader (Vereinsseite und Meldung, geprüft 2026-11-21), Namen und IDs erfunden.
const TEAM_ID = "3000001";

const clubTeamsLoader = {
    data: {
        teams_list: {
            club_nr: "2000001",
            club_name: "TTV Beispielstadt",
            club_teams: [
                {
                    season: "26/27",
                    team_id: TEAM_ID,
                    team_nr: 1,
                    group_id: "500001",
                    team_name: "Erwachsene",
                    points_won: "6",
                    table_rank: "4",
                    league_name: "Erwachsenen Bezirksklasse, Gr.1",
                    points_lost: "4",
                    contest_type: "Erwachsene",
                    team_organisation_short: "TTBW"
                },
                {
                    season: "26/27",
                    team_id: "3000002",
                    team_nr: 2,
                    group_id: "500002",
                    team_name: "Erwachsene II",
                    points_won: "5",
                    table_rank: "3",
                    league_name: "Erwachsenen Kreisliga B, Gr.2",
                    points_lost: "3",
                    contest_type: "Erwachsene",
                    team_organisation_short: "TTBW"
                }
            ]
        },
        no_meetings: false,
        meetings_excerpt: {}
    },
    season: "26--27",
    association: "TTBW",
    clubid: "2000001",
    clubname: "x",
    error: null
};

// Der Loader scheitert komplett, wenn der NU Feed für die Spieltermine streikt.
const clubTeamsLoaderFeedError = {
    data: null,
    season: "26--27",
    association: "TTBW",
    clubid: "2000001",
    clubname: "x",
    error: { code: "PT500", message: "Failed to read NU feed" }
};

function lineupRow(id: string, rank: number, teamNumber: number, firstname: string, lastname: string) {
    return {
        player_id: id,
        player_qttr: 1500 - rank * 10 - teamNumber * 100,
        player_rank: rank,
        team_number: teamNumber,
        player_status: null,
        foreigner_type: null,
        player_lastname: lastname,
        player_firstname: firstname,
        player_qttr_comparable: true
    };
}

const lineupLoader = {
    data: {
        team: [
            lineupRow("NU100002", 2, 1, "Bernd", "Beispiel"),
            lineupRow("NU100001", 1, 1, "Anna", "Muster"),
            lineupRow("NU100003", 1, 2, "Carla", "Probe")
        ],
        clubnr: "2000001",
        club_name: "TTV Beispielstadt",
        age_group_name: "Erwachsene",
        not_approved_teams: []
    },
    season: "26--27",
    association: "TTBW",
    clubid: "2000001",
    clubname: "x",
    team_short: "Erwachsene"
};

const teamInfosLoader = {
    data: {
        club_id: "2000001",
        club_name: "TTV Beispielstadt",
        team_name: "TTV Beispielstadt",
        organisation_short: "TTBW"
    },
    season: "x",
    association: "x",
    error: null
};

function pageWithContext(routeId: string, data: unknown) {
    const context = JSON.stringify({ state: { loaderData: { root: {}, [routeId]: data } } });

    return new Response(`<html><body><script>window.__remixContext = ${context};</script></body></html>`, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
    });
}

/** Simuliert myTT: API gestört (503), Seiten nach Pfad. Gibt die abgerufenen Pfade zurück. */
async function withMockedMytt<T>(run: (requested: string[]) => Promise<T>): Promise<T> {
    const { resetBreakersForTests } = await import("../src/upstream/rateLimiter.js");

    resetBreakersForTests();

    const originalFetch = globalThis.fetch;
    const requested: string[] = [];

    globalThis.fetch = (async (input: string | URL | Request) => {
        const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
        const path = decodeURIComponent(url.pathname);

        requested.push(path);

        if (path.startsWith("/api/")) {
            return new Response("{}", { status: 503 });
        }

        if (path.endsWith("/mannschaften")) {
            return pageWithContext(CLUB_TEAMS_ROUTE_ID, clubTeamsLoader);
        }

        if (path.includes("/meldungendetails/")) {
            return pageWithContext(CLUB_LINEUP_ROUTE_ID, lineupLoader);
        }

        if (path.endsWith("/infos")) {
            return pageWithContext(TEAM_INFOS_ROUTE_ID, teamInfosLoader);
        }

        return new Response("not found", { status: 404 });
    }) as typeof fetch;

    try {
        return await run(requested);
    } finally {
        globalThis.fetch = originalFetch;
        resetBreakersForTests();
    }
}

describe("club teams page", () => {
    it("maps the team list to the API shape and keeps number and contest", () => {
        const response = parseUpstream(
            ClubTeamsResponseSchema,
            clubTeamsPageToApiResponse(clubTeamsLoader),
            "club_teams:html"
        );

        assert.equal(response.data.length, 2);
        assert.equal(response.data[0]?.team_id, TEAM_ID);
        assert.equal(response.data[0]?.league_name, "Erwachsenen Bezirksklasse, Gr.1");
        assert.equal(response.data[0]?.team_nr, 1);
        assert.equal(response.data[0]?.contest_type, "Erwachsene");
    });

    it("rejects loader data without a team list (NU feed error)", () => {
        assert.throws(() => clubTeamsPageToApiResponse(clubTeamsLoaderFeedError), RemixContextParseError);
        assert.throws(() => clubTeamsPageToApiResponse({}), RemixContextParseError);
    });
});

describe("team lineup page", () => {
    it("keeps only the wanted team, sorted by rank, with the API field names", () => {
        const response = parseUpstream(
            TeamPlayersResponseSchema,
            teamLineupToApiResponse(lineupLoader, 1),
            "team_players:html"
        );

        assert.deepEqual(response.data, [
            { firstname: "Anna", lastname: "Muster", internal_id: "NU100001", rank: 1 },
            { firstname: "Bernd", lastname: "Beispiel", internal_id: "NU100002", rank: 2 }
        ]);
    });

    it("returns an empty list while the lineup is not approved yet", () => {
        const response = teamLineupToApiResponse({ data: { ...lineupLoader.data, team: null } }, 1);

        assert.deepEqual(response.data, []);
    });

    it("rejects loader data without data", () => {
        assert.throws(() => teamLineupToApiResponse({ data: null }, 1), RemixContextParseError);
    });

    it("builds the team info path from the team id alone", () => {
        assert.equal(buildTeamInfosPagePath("3096497"), "/click-tt/x/x/ligen/x/gruppe/x/mannschaft/3096497/x/infos");
    });
});

describe("club teams and team players fallback", () => {
    it("reads the club teams from the club page when the API fails", async () => {
        const { getClubTeams } = await import("../src/mytt/club.js");
        const { runWithLoadOrigin } = await import("../src/cache/loadOrigin.js");

        await withMockedMytt(async (requested) => {
            const { value, origin } = await runWithLoadOrigin(() =>
                getClubTeams({ organization: "TTBW", clubNumber: "2000001" })
            );

            assert.equal(origin, "html");
            assert.equal(value.data.length, 2);
            assert.equal(requested[0], "/api/ttr/teams");
            assert.match(requested[1] ?? "", /^\/click-tt\/TTBW\/\d{2}--\d{2}\/verein\/2000001\/x\/mannschaften$/);
        });
    });

    it("finds club, team and lineup from the pages when the API fails", async () => {
        const { getTeamPlayers } = await import("../src/mytt/team.js");
        const { runWithLoadOrigin } = await import("../src/cache/loadOrigin.js");

        await withMockedMytt(async (requested) => {
            const { value, origin } = await runWithLoadOrigin(() => getTeamPlayers({ teamId: TEAM_ID }));

            assert.equal(origin, "html");
            assert.deepEqual(
                value.data.map((player) => (player as { internal_id: string }).internal_id),
                ["NU100001", "NU100002"]
            );
            assert.equal(requested[0], "/api/ttr/team/players");
            assert.equal(requested[1], buildTeamInfosPagePath(TEAM_ID));
            assert.match(requested[2] ?? "", /\/verein\/2000001\/x\/mannschaften$/);
            assert.ok(requested.slice(3).every((path) => /\/verein\/2000001\/x\/meldungendetails\/Erwachsene\/(vr|rr)$/.test(path)));
        });
    });

    it("skips the club page when the caller already knows the team list", async () => {
        const { getTeamPlayers } = await import("../src/mytt/team.js");
        const known = clubTeamsPageToApiResponse(clubTeamsLoader);

        await withMockedMytt(async (requested) => {
            const value = await getTeamPlayers(
                { teamId: TEAM_ID },
                { getClubTeams: () => parseUpstream(ClubTeamsResponseSchema, known, "known") }
            );

            assert.equal(value.data.length, 2);
            assert.ok(!requested.some((path) => path.endsWith("/mannschaften")));
        });
    });

    it("loads the club page when the known list comes from the API (no team number)", async () => {
        const { getTeamPlayers } = await import("../src/mytt/team.js");
        const fromApi = {
            data: [{ team_id: TEAM_ID, team_name: "Erwachsene", league_name: "Bezirksklasse" }],
            error: null
        };

        await withMockedMytt(async (requested) => {
            const value = await getTeamPlayers({ teamId: TEAM_ID }, { getClubTeams: () => fromApi });

            assert.equal(value.data.length, 2);
            assert.ok(requested.some((path) => path.endsWith("/mannschaften")));
        });
    });

    it("stores club list and lineup, a second team of the club needs only API and team info", async () => {
        const { getTeamPlayers } = await import("../src/mytt/team.js");
        const clubTeams = new Map<string, ClubTeamsResponse>();
        const lineups = new Map<string, JsonRecord>();
        const store = {
            getClubTeams: (organization: string, clubNumber: string) => clubTeams.get(`${organization}:${clubNumber}`),
            putClubTeams: (organization: string, clubNumber: string, teams: ClubTeamsResponse) => {
                clubTeams.set(`${organization}:${clubNumber}`, teams);
            },
            getLineup: (ref: ClubLineupRef) => lineups.get(JSON.stringify(ref)),
            putLineup: (ref: ClubLineupRef, routeData: JsonRecord) => {
                lineups.set(JSON.stringify(ref), routeData);
            }
        };

        await withMockedMytt(async (requested) => {
            await getTeamPlayers({ teamId: TEAM_ID }, store);

            assert.ok(clubTeams.has("TTBW:2000001"));
            assert.ok(lineups.size > 0);
            assert.ok([...lineups.keys()].every((key) => JSON.parse(key).contestType === "Erwachsene"));

            requested.length = 0;

            const second = await getTeamPlayers({ teamId: "3000002" }, store);

            assert.deepEqual(
                second.data.map((player) => (player as { internal_id: string }).internal_id),
                ["NU100003"]
            );
            assert.deepEqual(requested, ["/api/ttr/team/players", buildTeamInfosPagePath("3000002")]);
        });
    });
});

describe("lineup half selection", () => {
    const filled = { data: [{ internal_id: "NU1" }] };
    const empty = { data: [] };
    const fulfilled = <T>(value: T): PromiseSettledResult<T> => ({ status: "fulfilled", value });
    const rejected = (reason: unknown): PromiseSettledResult<never> => ({ status: "rejected", reason });

    it("prefers the first half with players", () => {
        assert.equal(pickLineup([fulfilled(empty), fulfilled(filled)]), filled);
        assert.equal(pickLineup([fulfilled(filled), fulfilled(empty)]), filled);
    });

    it("uses the other half when one page failed", () => {
        assert.equal(pickLineup([rejected(new UpstreamError("timeout")), fulfilled(filled)]), filled);
    });

    it("throws the failure instead of an empty list that could be wrong", () => {
        const failure = new UpstreamError("timeout");

        assert.throws(() => pickLineup([rejected(failure), fulfilled(empty)]), (error) => error === failure);
    });

    it("returns the empty list while no half is approved", () => {
        assert.equal(pickLineup([fulfilled(empty), fulfilled(empty)]), empty);
    });

    it("throws a relay miss first, even when the other half has players", () => {
        const miss = new RelayRequiredError();

        assert.throws(() => pickLineup([rejected(miss), fulfilled(filled)]), (error) => error === miss);
        assert.throws(
            () => pickLineup([rejected(new UpstreamError("timeout")), rejected(miss)]),
            (error) => error === miss
        );
    });
});
