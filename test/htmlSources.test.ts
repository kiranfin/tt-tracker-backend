import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    parseLeagueTableFromHtmlTable,
    promotionStateOfApiRow
} from "../src/sources/html/leagueTable.js";
import {
    getRouteDataFromHtml,
    RemixContextParseError
} from "../src/sources/html/remixContext.js";

const ROUTE_ID = "routes/click-tt+/$association+/$season+/$type+/tabelle.$filter";

function pageWithContext(loaderData: unknown) {
    const context = JSON.stringify({ state: { loaderData } });

    return `<html><body><script>window.__remixContext = ${context};</script></body></html>`;
}

const TABLE_HTML = `
<table>
  <thead><tr><th>Rang</th><th>Mannschaft</th><th>Beg.</th><th>S</th><th>U</th><th>N</th><th>Spiele</th><th>+/-</th><th>Punkte</th></tr></thead>
  <tbody>
    <tr>
      <td><svg><use href="/icons.svg#rise"></use></svg><span>1</span></td>
      <td><a href="/click-tt/WTTV/25--26/ligen/x/gruppe/1/mannschaft/777/Team_A/spielerbilanzen/gesamt">Team A</a></td>
      <td>14</td><td>13</td><td>0</td><td>1</td>
      <td><button>123<!-- -->:<!-- -->43</button></td><td>+80</td><td>26<!-- -->:<!-- -->2</td>
    </tr>
    <tr>
      <td><span>2</span></td>
      <td><a href="/click-tt/WTTV/25--26/ligen/x/gruppe/1/mannschaft/888/Team_B/spielerbilanzen/gesamt">Team B</a></td>
      <td>14</td><td>5</td><td>2</td><td>7</td>
      <td>60:70</td><td>-10</td><td>12:16</td>
    </tr>
    <tr>
      <td><svg><use href="/icons.svg#fall"></use></svg><span>3</span></td>
      <td><a href="/click-tt/WTTV/25--26/ligen/x/gruppe/1/mannschaft/999/Team_C/spielerbilanzen/gesamt">Team C</a></td>
      <td>14</td><td>1</td><td>0</td><td>13</td>
      <td>20:100</td><td>-80</td><td>2:26</td>
    </tr>
  </tbody>
</table>`;

describe("remix context", () => {
    it("finds the loader data of a route by its exact id", () => {
        const page = pageWithContext({
            root: { a: 1 },
            [ROUTE_ID]: { data: { league_table: [] } }
        });

        assert.deepEqual(getRouteDataFromHtml(page, ROUTE_ID), { data: { league_table: [] } });
    });

    it("falls back to the last route segment when the prefix changed", () => {
        const page = pageWithContext({
            root: {},
            "routes/other-prefix+/tabelle.$filter": { data: "x" }
        });

        assert.deepEqual(getRouteDataFromHtml(page, ROUTE_ID), { data: "x" });
    });

    it("fails with a parse error when the route is missing", () => {
        assert.throws(
            () => getRouteDataFromHtml(pageWithContext({ root: {} }), ROUTE_ID),
            RemixContextParseError
        );
    });

    it("names React Router 7 pages in the error", () => {
        assert.throws(
            () => getRouteDataFromHtml("<script>window.__reactRouterContext = {};</script>", ROUTE_ID),
            /React Router 7/
        );
    });
});

describe("league table page", () => {
    it("maps API rise/fall values to promotion states", () => {
        assert.equal(promotionStateOfApiRow({ rise_fall_state: "rise" }), "promotion");
        assert.equal(promotionStateOfApiRow({ rise_fall_state: "fall", tendency: "rise" }), "relegation");
        assert.equal(promotionStateOfApiRow({ tendency: "rise" }), "promotion");
        assert.equal(promotionStateOfApiRow({ rise_fall_state: null, tendency: "fall" }), "relegation");
        assert.equal(promotionStateOfApiRow({ rise_fall_state: "riseRelegation", tendency: "steady" }), "promotionPlayoff");
        assert.equal(promotionStateOfApiRow({ rise_fall_state: "fallRelegation" }), "relegationPlayoff");
        assert.equal(promotionStateOfApiRow({ rise_fall_state: "none", tendency: "steady" }), "none");
        assert.equal(promotionStateOfApiRow({ tendency: "none" }), "none");
        assert.equal(promotionStateOfApiRow({}), "none");
    });

    it("parses the visible table as last resort", () => {
        const { data } = parseLeagueTableFromHtmlTable(TABLE_HTML);

        assert.equal(data.length, 3);
        assert.equal(data[0].team_name, "Team A");
        assert.equal(data[0].team_id, "777");
        assert.equal(data[0].table_rank, 1);
        assert.equal(data[0].meetings_won, 13);
        assert.equal(data[0].matches_won, 123);
        assert.equal(data[0].matches_lost, 43);
        assert.equal(data[0].points_won, 26);
        assert.equal(data[0].points_lost, 2);
        assert.equal(data[0].matches_relation, "+80");
        assert.deepEqual(
            data.map((row) => row.promotion_state),
            ["promotion", "none", "relegation"]
        );
    });

    it("ignores a second table behind the league table and reads columns by header", () => {
        const swapped = `
<html><body>
<table>
  <thead><tr><th>Punkte</th><th>Mannschaft</th><th>+/-</th><th>Rang</th><th>Spiele</th></tr></thead>
  <tbody>
    <tr><td>26:2</td><td><a href="/x/mannschaft/777/Team_A/y">Team A</a></td><td>+80</td><td><svg><use href="/i.svg#rise"></use></svg>1</td><td>123:43</td></tr>
    <tr><td>12:16</td><td><a href="/x/mannschaft/888/Team_B/y">Team B</a></td><td>-10</td><td>2</td><td>60:70</td></tr>
  </tbody>
</table>
<table>
  <thead><tr><th>Datum</th><th>Heim</th><th>Gast</th></tr></thead>
  <tbody>
    <tr><td>01.09.</td><td><svg><use href="/i.svg#fall"></use></svg>Team C</td><td>Team D</td></tr>
  </tbody>
</table>
</body></html>`;

        const { data } = parseLeagueTableFromHtmlTable(swapped);

        assert.equal(data.length, 2);
        assert.equal(data[0].team_name, "Team A");
        assert.equal(data[0].table_rank, 1);
        assert.equal(data[0].points_won, 26);
        assert.equal(data[0].matches_relation, "+80");
        assert.equal(data[0].matches_won, 123);
        assert.deepEqual(
            data.map((row) => row.promotion_state),
            ["promotion", "none"]
        );
    });

    it("reads playoff places from the secondary icons", () => {
        const html = `
<table>
  <thead><tr><th>Rang</th><th>Mannschaft</th><th>Punkte</th></tr></thead>
  <tbody>
    <tr><td><svg><use href="/i.svg#rise-secondary"></use></svg>1</td><td><a href="/x/mannschaft/1/A/y">A</a></td><td>10:2</td></tr>
    <tr><td><svg><use href="/i.svg#fall-secondary"></use></svg>2</td><td><a href="/x/mannschaft/2/B/y">B</a></td><td>2:10</td></tr>
  </tbody>
</table>`;

        const { data } = parseLeagueTableFromHtmlTable(html);

        assert.deepEqual(
            data.map((row) => row.promotion_state),
            ["promotionPlayoff", "relegationPlayoff"]
        );
    });

    it("rejects a table without the required columns", () => {
        const html = "<table><thead><tr><th>Rang</th><th>Mannschaft</th></tr></thead><tbody><tr><td>1</td><td>A</td></tr></tbody></table>";

        assert.throws(() => parseLeagueTableFromHtmlTable(html), RemixContextParseError);
    });

    it("rejects a page without a league table", () => {
        assert.throws(
            () => parseLeagueTableFromHtmlTable("<html><body><p>nothing</p></body></html>"),
            RemixContextParseError
        );
    });
});
