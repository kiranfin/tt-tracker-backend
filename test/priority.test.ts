import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getUpstreamPriority, runInBackground } from "../src/upstream/priority.js";

describe("upstream priority", () => {
    it("is interactive by default", () => {
        assert.equal(getUpstreamPriority(), "interactive");
    });

    it("is background inside runInBackground, also across awaits", async () => {
        const seen = await runInBackground(async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));

            return getUpstreamPriority();
        });

        assert.equal(seen, "background");
        assert.equal(getUpstreamPriority(), "interactive");
    });
});
