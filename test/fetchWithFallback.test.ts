import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runWithLoadOrigin } from "../src/cache/loadOrigin.js";
import { fetchWithFallback } from "../src/sources/fetchWithFallback.js";
import { RemixContextParseError } from "../src/sources/html/remixContext.js";
import {
    LocalRateLimitError,
    UpstreamError,
    UpstreamFormatError,
    UpstreamRateLimitError
} from "../src/upstream/errors.js";
import { MyttSessionExpiredError } from "../src/myttSessionStore.js";

describe("fetchWithFallback", () => {
    it("returns the primary result and skips the fallback", async () => {
        let fallbackCalls = 0;

        const { value, origin } = await runWithLoadOrigin(() =>
            fetchWithFallback({
                name: "test_primary",
                primary: async () => "api",
                fallback: async () => {
                    fallbackCalls += 1;
                    return "html";
                }
            })
        );

        assert.equal(value, "api");
        assert.equal(origin, "upstream");
        assert.equal(fallbackCalls, 0);
    });

    it("falls back to the page when the API fails and marks the origin as html", async () => {
        const { value, origin } = await runWithLoadOrigin(() =>
            fetchWithFallback({
                name: "test_fallback",
                primary: async () => {
                    throw new UpstreamError("HTTP 500");
                },
                fallback: async () => "html"
            })
        );

        assert.equal(value, "html");
        assert.equal(origin, "html");
    });

    it("falls back on format errors only with fallbackOnFormatError", async () => {
        const errors = [
            new UpstreamFormatError("test", ["x: Required"]),
            new RemixContextParseError("no context")
        ];

        for (const error of errors) {
            const result = await fetchWithFallback({
                name: "test_format_on",
                fallbackOnFormatError: true,
                primary: async () => {
                    throw error;
                },
                fallback: async () => "html"
            });

            assert.equal(result, "html");

            let fallbackCalls = 0;

            await assert.rejects(
                fetchWithFallback({
                    name: "test_format_off",
                    primary: async () => {
                        throw error;
                    },
                    fallback: async () => {
                        fallbackCalls += 1;
                        return "html";
                    }
                }),
                (thrown: unknown) => thrown === error
            );

            assert.equal(fallbackCalls, 0);
        }
    });

    it("falls back on network errors and 5xx", async () => {
        for (const error of [
            new UpstreamError("timeout"),
            new UpstreamError("HTTP 503", 503)
        ]) {
            const result = await fetchWithFallback({
                name: "test_retryable",
                primary: async () => {
                    throw error;
                },
                fallback: async () => "html"
            });

            assert.equal(result, "html");
        }
    });

    it("does not fall back on 4xx and 429", async () => {
        const errors = [
            new UpstreamError("HTTP 404", 404),
            new UpstreamError("HTTP 400", 400),
            new UpstreamRateLimitError()
        ];

        for (const error of errors) {
            let fallbackCalls = 0;

            await assert.rejects(
                fetchWithFallback({
                    name: "test_no_retry",
                    fallbackOnFormatError: true,
                    primary: async () => {
                        throw error;
                    },
                    fallback: async () => {
                        fallbackCalls += 1;
                        return "html";
                    }
                }),
                (thrown: unknown) => thrown === error
            );

            assert.equal(fallbackCalls, 0);
        }
    });

    it("does not fall back on session or local limit errors", async () => {
        const errors = [
            new MyttSessionExpiredError({ sessionOwnerUserId: "u", delegated: false }),
            new LocalRateLimitError(1000, "breaker_open")
        ];

        for (const error of errors) {
            let fallbackCalls = 0;

            await assert.rejects(
                fetchWithFallback({
                    name: "test_passthrough",
                    primary: async () => {
                        throw error;
                    },
                    fallback: async () => {
                        fallbackCalls += 1;
                        return "html";
                    }
                }),
                (thrown: unknown) => thrown === error
            );

            assert.equal(fallbackCalls, 0);
        }
    });

    it("throws the API error when both sources fail", async () => {
        const apiError = new UpstreamError("api down");

        await assert.rejects(
            fetchWithFallback({
                name: "test_both_fail",
                primary: async () => {
                    throw apiError;
                },
                fallback: async () => {
                    throw new Error("page down");
                }
            }),
            (thrown: unknown) => thrown === apiError
        );
    });

    it("with the page as primary source, falls back to the API and keeps the origin", async () => {
        const { value, origin } = await runWithLoadOrigin(() =>
            fetchWithFallback({
                name: "test_page_first",
                primarySource: "html",
                primary: async () => {
                    throw new UpstreamError("page broke");
                },
                fallback: async () => "api"
            })
        );

        assert.equal(value, "api");
        assert.equal(origin, "upstream");
    });
});
