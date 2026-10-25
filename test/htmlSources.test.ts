import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    extractPromotionStatesFromTableHtml,
    parseLeagueTableFromHtmlTable
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
    it("reads promotion and relegation icons per row", () => {
        assert.deepEqual(extractPromotionStatesFromTableHtml(TABLE_HTML), [
            "promotion",
            "none",
            "relegation"
        ]);
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
        assert.deepEqual(
            data.map((row) => row.promotion_state),
            ["promotion", "none", "relegation"]
        );
    });

    it("rejects a page without a league table", () => {
        assert.throws(
            () => parseLeagueTableFromHtmlTable("<html><body><p>nothing</p></body></html>"),
            RemixContextParseError
        );
    });
});
