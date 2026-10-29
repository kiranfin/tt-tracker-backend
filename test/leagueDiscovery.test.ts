import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    championshipSlugFromUrl,
    extractRegionLinks,
    regionsFromHierarchy,
    resolveAssociation,
    toChampionshipSlug
} from "../src/mytt/leagueDiscovery.js";

describe("league regions", () => {
    it("reads championship links from the overview page", () => {
        const html = `
            <a href="/click-tt/WTTV/26--27/ligen/WTTV_26--27">NRW-/Verbands-/Landesligen</a>
            <a href="/click-tt/WTTV/26--27/ligen/K%C3%B6ln_26--27">Köln</a>`;

        const regions = extractRegionLinks(html, "WTTV", "26--27");

        assert.deepEqual(
            regions.map((region) => region.championshipSlug),
            ["WTTV_26--27", "Köln_26--27"]
        );
    });

    it("ignores links to single groups", () => {
        const html = `
            <a href="/click-tt/TTBW/26--27/ligen/Landesliga_Gr._1/gruppe/520588/tabelle/gesamt">Landesliga Gr. 1</a>
            <a href="/click-tt/TTBW/26--27/ligen/Verbandsliga_Nord/gruppe/520509/tabelle/gesamt">Verbandsliga Nord</a>`;

        assert.deepEqual(extractRegionLinks(html, "TTBW", "26--27"), []);
    });

    it("takes the championship from a redirected overview url", () => {
        assert.equal(
            championshipSlugFromUrl(
                "https://www.mytischtennis.de/click-tt/TTBW/26--27/ligen/SK_TTBW_26--27",
                "TTBW",
                "26--27"
            ),
            "SK_TTBW_26--27"
        );

        assert.equal(
            championshipSlugFromUrl("https://www.mytischtennis.de/click-tt/WTTV/26--27/ligen", "WTTV", "26--27"),
            null
        );
    });

    it("builds slugs the way myTischtennis does", () => {
        assert.equal(toChampionshipSlug("SK Bez. HN 26/27"), "SK_Bez._HN_26--27");
        assert.equal(toChampionshipSlug("Frankfurt/Oder 2026/27"), "Frankfurt--Oder_2026--27");
    });

    it("lists the root and its children of the same association", () => {
        const regions = regionsFromHierarchy(
            {
                lowerLeagues: [
                    {
                        type: "CHILD",
                        regionName: "Heilbronn",
                        championshipName: "Bezirk Heilbronn 2026/27",
                        championshipNickname: "SK Bez. HN 26/27",
                        federationNickname: "TTBW"
                    },
                    {
                        type: "CHILD",
                        regionName: "Hessen",
                        championshipName: "Hessischer TT-Verband 2026/27",
                        championshipNickname: "HTTV 26/27",
                        federationNickname: "HeTTV"
                    }
                ]
            },
            "TTBW",
            "26--27",
            "SK_TTBW_26--27"
        );

        assert.deepEqual(
            regions.map((region) => [region.name, region.championshipSlug, region.type]),
            [
                ["Verbandsspielklassen", "SK_TTBW_26--27", "association"],
                ["Bezirk Heilbronn", "SK_Bez._HN_26--27", "region"]
            ]
        );
    });

    it("tells Sachsen and Sachsen-Anhalt apart", () => {
        assert.equal(resolveAssociation("Sachsen")?.association, "STTV");
        assert.equal(resolveAssociation("Sachsen-Anhalt")?.association, "TTVSA");
    });
});
