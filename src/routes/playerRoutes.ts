import type { FastifyInstance } from "fastify";
import { getRequiredAppUserId } from "../appUser.js";
import {
    getPlayerHeadToHead,
    getPlayerTtr,
    getPlayerTtrHistory
} from "../myttClient.js";
import { handleApiError } from "../utils/errors.js";

function normalizeNuid(nuid: string) {
    return nuid.trim().toUpperCase();
}

function toHeadToHeadOtherUser(nuid: string) {
    const normalized = normalizeNuid(nuid);

    if (normalized.startsWith("NU")) {
        return normalized.slice(2);
    }

    return normalized;
}

function hasAuthError(response: { error?: unknown | null }) {
    return response.error !== null && response.error !== undefined;
}

type CompareSide = "left" | "right";
type CompareLeader = CompareSide | "tie" | "unknown";

function asRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }

    return value as Record<string, unknown>;
}

function asNullableNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === "string" && value.trim().length > 0) {
        const parsed = Number(value.replace(",", "."));

        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return null;
}

function asNullableString(value: unknown): string | null {
    if (typeof value === "string" && value.trim().length > 0) {
        return value;
    }

    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
    }

    return null;
}

function roundNumber(value: number | null, digits = 1) {
    if (value === null || !Number.isFinite(value)) {
        return null;
    }

    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
}

function firstNumber(
    record: Record<string, unknown>,
    keys: string[]
): number | null {
    for (const key of keys) {
        const value = asNullableNumber(record[key]);

        if (value !== null) {
            return value;
        }
    }

    return null;
}

function firstString(
    record: Record<string, unknown>,
    keys: string[]
): string | null {
    for (const key of keys) {
        const value = asNullableString(record[key]);

        if (value !== null) {
            return value;
        }
    }

    return null;
}

function parseTimestamp(value: string | null) {
    if (!value) return null;

    const timestamp = Date.parse(value);

    return Number.isFinite(timestamp) ? timestamp : null;
}

function getNumberDifference(left: number | null, right: number | null) {
    if (left === null || right === null) {
        return null;
    }

    return left - right;
}

function getLeader(
    left: number | null,
    right: number | null,
    higherIsBetter = true
): CompareLeader {
    if (left === null || right === null) {
        return "unknown";
    }

    if (left === right) {
        return "tie";
    }

    if (higherIsBetter) {
        return left > right ? "left" : "right";
    }

    return left < right ? "left" : "right";
}

function buildNumberComparison(params: {
    left: number | null;
    right: number | null;
    higherIsBetter?: boolean;
}) {
    const difference = getNumberDifference(params.left, params.right);

    return {
        left: params.left,
        right: params.right,
        difference,
        absoluteDifference:
            difference === null ? null : Math.abs(difference),
        leader: getLeader(
            params.left,
            params.right,
            params.higherIsBetter ?? true
        )
    };
}

function buildRatingOdds(leftTtr: number | null, rightTtr: number | null) {
    const difference = getNumberDifference(leftTtr, rightTtr);

    if (difference === null) {
        return {
            available: false,
            favorite: "unknown" as CompareLeader,
            ttrDifference: null,
            leftWinProbability: null,
            rightWinProbability: null
        };
    }

    const leftProbability = 1 / (1 + 10 ** (-difference / 400));
    const rightProbability = 1 - leftProbability;

    return {
        available: true,
        favorite: getLeader(leftTtr, rightTtr),
        ttrDifference: difference,
        leftWinProbability: roundNumber(leftProbability, 3),
        rightWinProbability: roundNumber(rightProbability, 3)
    };
}

type HistoryPoint = {
    index: number;
    date: string | null;
    timestamp: number | null;
    ttr: number;
    label: string | null;
};

function normalizeHistoryPoints(events: unknown[]): HistoryPoint[] {
    const points = events
        .map((event, index): HistoryPoint | null => {
            const record = asRecord(event);

            const ttr = firstNumber(record, [
                "ttr",
                "qttr",
                "value",
                "rating",
                "new_ttr",
                "ttr_new",
                "player_ttr",
                "fedRank"
            ]);

            if (ttr === null) {
                return null;
            }

            const date = firstString(record, [
                "date",
                "datum",
                "event_date",
                "ttr_date",
                "created_at",
                "createdAt"
            ]);

            return {
                index,
                date,
                timestamp: parseTimestamp(date),
                ttr,
                label: firstString(record, [
                    "event",
                    "event_name",
                    "name",
                    "description",
                    "type"
                ])
            };
        })
        .filter((point): point is HistoryPoint => point !== null);

    const hasUsableDates = points.some((point) => point.timestamp !== null);

    if (!hasUsableDates) {
        return points;
    }

    return [...points].sort((left, right) => {
        if (left.timestamp === null && right.timestamp === null) {
            return left.index - right.index;
        }

        if (left.timestamp === null) return 1;
        if (right.timestamp === null) return -1;

        return left.timestamp - right.timestamp;
    });
}

function buildHistoryStats(points: HistoryPoint[]) {
    if (points.length === 0) {
        return {
            eventCount: 0,
            firstTtr: null,
            latestTtr: null,
            minTtr: null,
            maxTtr: null,
            averageTtr: null,
            totalChange: null,
            lastChange: null,
            recentChange5: null,
            recentChange10: null,
            averageChangePerEvent: null,
            volatility: null,
            trend: "unknown" as const
        };
    }

    const values = points.map((point) => point.ttr);
    const firstTtr = values[0] ?? null;
    const latestTtr = values.at(-1) ?? null;

    const changes = values
        .slice(1)
        .map((value, index) => value - values[index]);

    const totalChange =
        firstTtr === null || latestTtr === null ? null : latestTtr - firstTtr;

    const averageChange =
        changes.length === 0
            ? null
            : changes.reduce((sum, value) => sum + value, 0) / changes.length;

    const volatility =
        changes.length === 0
            ? null
            : changes.reduce((sum, value) => sum + Math.abs(value), 0) /
            changes.length;

    const recentChange = (count: number) => {
        if (values.length < 2) return null;

        const recentValues = values.slice(-count);
        const first = recentValues[0];
        const latest = recentValues.at(-1);

        if (first === undefined || latest === undefined) {
            return null;
        }

        return latest - first;
    };

    let trend: "rising" | "falling" | "stable" | "unknown" = "unknown";

    if (totalChange !== null) {
        if (totalChange > 0) trend = "rising";
        else if (totalChange < 0) trend = "falling";
        else trend = "stable";
    }

    return {
        eventCount: points.length,
        firstTtr,
        latestTtr,
        minTtr: Math.min(...values),
        maxTtr: Math.max(...values),
        averageTtr: roundNumber(
            values.reduce((sum, value) => sum + value, 0) / values.length,
            1
        ),
        totalChange,
        lastChange: changes.at(-1) ?? null,
        recentChange5: recentChange(5),
        recentChange10: recentChange(10),
        averageChangePerEvent: roundNumber(averageChange, 2),
        volatility: roundNumber(volatility, 2),
        trend
    };
}

function buildPlayerSnapshot(params: {
    nuid: string;
    ttrResult: Awaited<ReturnType<typeof getPlayerTtr>>;
    historyResult: Awaited<ReturnType<typeof getPlayerTtrHistory>>;
}) {
    const events = Array.isArray(params.historyResult.event)
        ? params.historyResult.event
        : [];

    const historyPoints = normalizeHistoryPoints(events);
    const historyStats = buildHistoryStats(historyPoints);

    const currentTtr =
        asNullableNumber(params.ttrResult.ttr) ??
        asNullableNumber(params.historyResult.ttr) ??
        historyStats.latestTtr;

    const qttr =
        asNullableNumber(params.historyResult.vq_ttr) ??
        asNullableNumber(params.historyResult.ttr_last_fixed);

    const maxTtr =
        asNullableNumber(params.historyResult.max_ttr) ??
        historyStats.maxTtr;

    return {
        nuid: params.nuid,
        available: {
            ttr: !hasAuthError(params.ttrResult) && currentTtr !== null,
            history: !hasAuthError(params.historyResult),
            any:
                (!hasAuthError(params.ttrResult) && currentTtr !== null) ||
                !hasAuthError(params.historyResult)
        },
        identity: {
            personName: params.historyResult.person_name ?? null,
            clubName: params.historyResult.club_name ?? null
        },
        ratings: {
            currentTtr,
            qttr,
            qttrDate: params.historyResult.ttr_last_fixed_date ?? null,
            maxTtr,
            maxTtrDate: params.historyResult.max_ttr_date ?? null,
            ttrDate: params.historyResult.ttr_date ?? null
        },
        history: {
            stats: historyStats,
            points: historyPoints.map((point) => ({
                date: point.date,
                ttr: point.ttr,
                label: point.label
            })),
            recentEvents: events.slice(-10)
        },
        error: {
            ttr: params.ttrResult.error ?? null,
            history: params.historyResult.error ?? null
        }
    };
}

function buildComparison(
    left: ReturnType<typeof buildPlayerSnapshot>,
    right: ReturnType<typeof buildPlayerSnapshot>
) {
    return {
        ratings: {
            currentTtr: buildNumberComparison({
                left: left.ratings.currentTtr,
                right: right.ratings.currentTtr
            }),
            qttr: buildNumberComparison({
                left: left.ratings.qttr,
                right: right.ratings.qttr
            }),
            maxTtr: buildNumberComparison({
                left: left.ratings.maxTtr,
                right: right.ratings.maxTtr
            })
        },
        history: {
            eventCount: buildNumberComparison({
                left: left.history.stats.eventCount,
                right: right.history.stats.eventCount
            }),
            totalChange: buildNumberComparison({
                left: left.history.stats.totalChange,
                right: right.history.stats.totalChange
            }),
            lastChange: buildNumberComparison({
                left: left.history.stats.lastChange,
                right: right.history.stats.lastChange
            }),
            recentChange5: buildNumberComparison({
                left: left.history.stats.recentChange5,
                right: right.history.stats.recentChange5
            }),
            recentChange10: buildNumberComparison({
                left: left.history.stats.recentChange10,
                right: right.history.stats.recentChange10
            }),
            volatility: buildNumberComparison({
                left: left.history.stats.volatility,
                right: right.history.stats.volatility,
                higherIsBetter: false
            })
        },
        odds: {
            byCurrentTtr: buildRatingOdds(
                left.ratings.currentTtr,
                right.ratings.currentTtr
            ),
            byQttr: buildRatingOdds(left.ratings.qttr, right.ratings.qttr),
            byMaxTtr: buildRatingOdds(
                left.ratings.maxTtr,
                right.ratings.maxTtr
            )
        },
        sameClub:
            left.identity.clubName !== null &&
            right.identity.clubName !== null &&
            left.identity.clubName === right.identity.clubName
    };
}

function buildSummary(
    left: ReturnType<typeof buildPlayerSnapshot>,
    right: ReturnType<typeof buildPlayerSnapshot>,
    comparison: ReturnType<typeof buildComparison>
) {
    return {
        strongerCurrent:
            comparison.ratings.currentTtr.leader === "left"
                ? left.nuid
                : comparison.ratings.currentTtr.leader === "right"
                    ? right.nuid
                    : comparison.ratings.currentTtr.leader,
        strongerQttr:
            comparison.ratings.qttr.leader === "left"
                ? left.nuid
                : comparison.ratings.qttr.leader === "right"
                    ? right.nuid
                    : comparison.ratings.qttr.leader,
        betterRecentForm:
            comparison.history.recentChange5.leader === "left"
                ? left.nuid
                : comparison.history.recentChange5.leader === "right"
                    ? right.nuid
                    : comparison.history.recentChange5.leader,
        moreStable:
            comparison.history.volatility.leader === "left"
                ? left.nuid
                : comparison.history.volatility.leader === "right"
                    ? right.nuid
                    : comparison.history.volatility.leader,
        currentTtrDifference: comparison.ratings.currentTtr.difference,
        qttrDifference: comparison.ratings.qttr.difference,
        favoriteByCurrentTtr:
            comparison.odds.byCurrentTtr.favorite === "left"
                ? left.nuid
                : comparison.odds.byCurrentTtr.favorite === "right"
                    ? right.nuid
                    : comparison.odds.byCurrentTtr.favorite
    };
}

function parseScoreLikeResult(value: string | null) {
    if (!value) return null;

    const match = value.match(/(\d+)\s*[:.-]\s*(\d+)/);

    if (!match) return null;

    const left = Number(match[1]);
    const right = Number(match[2]);

    if (!Number.isFinite(left) || !Number.isFinite(right)) {
        return null;
    }

    return { left, right };
}

function getOwnOtherScoreFromHeadToHeadItem(item: unknown) {
    const record = asRecord(item);

    const setPoints = asRecord(record.set_points);
    const ownSetPoints = asNullableNumber(setPoints.own);
    const otherSetPoints = asNullableNumber(setPoints.other);

    if (ownSetPoints !== null && otherSetPoints !== null) {
        return {
            left: ownSetPoints,
            right: otherSetPoints
        };
    }

    const points = asRecord(record.points);
    const ownPoints = asNullableNumber(points.own);
    const otherPoints = asNullableNumber(points.other);

    if (ownPoints !== null && otherPoints !== null) {
        return {
            left: ownPoints,
            right: otherPoints
        };
    }

    const resultText = firstString(record, [
        "result",
        "ergebnis",
        "score",
        "match_result"
    ]);

    return parseScoreLikeResult(resultText);
}

function buildHeadToHeadStats(items: unknown[]) {
    let parsed = 0;
    let leftWins = 0;
    let rightWins = 0;
    let draws = 0;

    for (const item of items) {
        const score = getOwnOtherScoreFromHeadToHeadItem(item);

        if (!score) {
            continue;
        }

        parsed += 1;

        if (score.left > score.right) {
            leftWins += 1;
        } else if (score.right > score.left) {
            rightWins += 1;
        } else {
            draws += 1;
        }
    }

    return {
        itemCount: items.length,
        parsedItemCount: parsed,
        leftWins,
        rightWins,
        draws,
        leftWinRate:
            parsed === 0 ? null : roundNumber(leftWins / parsed, 3),
        rightWinRate:
            parsed === 0 ? null : roundNumber(rightWins / parsed, 3)
    };
}

function errorToResponse(error: unknown) {
    if (!error) return null;

    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message
        };
    }

    return {
        name: "UnknownError",
        message: "Unbekannter Fehler"
    };
}

export async function playerRoutes(app: FastifyInstance) {
    app.get("/api/players/:nuid/ttr", async (request, reply) => {
        try {
            const requestingUserId = getRequiredAppUserId(request);

            const { nuid: rawNuid } = request.params as { nuid: string };
            const nuid = normalizeNuid(rawNuid);

            if (!nuid || nuid.length < 3) {
                return reply.code(400).send({
                    error: {
                        code: "INVALID_INPUT",
                        message: "Ungültige Spieler-ID."
                    }
                });
            }

            const result = await getPlayerTtr({
                requestingUserId,
                nuid
            });

            return {
                data: {
                    nuid,
                    available: !hasAuthError(result) && result.ttr != null,
                    ttr: result.ttr ?? null,
                    error: result.error ?? null
                },
                meta: {
                    source: "upstream"
                }
            };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });

    app.get("/api/players/:nuid/ttr-history", async (request, reply) => {
        try {
            const requestingUserId = getRequiredAppUserId(request);

            const { nuid: rawNuid } = request.params as { nuid: string };
            const nuid = normalizeNuid(rawNuid);

            if (!nuid || nuid.length < 3) {
                return reply.code(400).send({
                    error: {
                        code: "INVALID_INPUT",
                        message: "Ungültige Spieler-ID."
                    }
                });
            }

            const result = await getPlayerTtrHistory({
                requestingUserId,
                nuid
            });

            return {
                data: {
                    nuid,
                    available: !hasAuthError(result),
                    ttr: result.ttr ?? null,
                    qttr: result.vq_ttr ?? Number(result.ttr_last_fixed) ?? null,
                    qttrDate: result.ttr_last_fixed_date ?? null,
                    maxTtr: result.max_ttr ?? null,
                    ttrDate: result.ttr_date ?? null,
                    maxTtrDate: result.max_ttr_date ?? null,
                    clubName: result.club_name ?? null,
                    personName: result.person_name ?? null,
                    events: result.event ?? [],
                    error: result.error ?? null
                },
                meta: {
                    source: "upstream"
                }
            };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });

    app.get("/api/players/:nuid/head-to-head", async (request, reply) => {
        try {
            const requestingUserId = getRequiredAppUserId(request);

            const { nuid: rawNuid } = request.params as { nuid: string };
            const nuid = normalizeNuid(rawNuid);
            const otherUser = toHeadToHeadOtherUser(nuid);

            if (!otherUser || otherUser.length < 3) {
                return reply.code(400).send({
                    error: {
                        code: "INVALID_INPUT",
                        message: "Ungültige Gegner-ID."
                    }
                });
            }

            const result = await getPlayerHeadToHead({
                requestingUserId,
                otherUser
            });

            return {
                data: {
                    nuid,
                    otherUser,
                    available: !hasAuthError(result),
                    items: Array.isArray(result.data) ? result.data : [],
                    error: result.error ?? null
                },
                meta: {
                    source: "upstream"
                }
            };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });

    app.get("/api/players/:leftNuid/compare/:rightNuid", async (request, reply) => {
        try {
            const requestingUserId = getRequiredAppUserId(request);

            const {
                leftNuid: rawLeftNuid,
                rightNuid: rawRightNuid
            } = request.params as {
                leftNuid: string;
                rightNuid: string;
            };

            const leftNuid = normalizeNuid(rawLeftNuid);
            const rightNuid = normalizeNuid(rawRightNuid);

            if (!leftNuid || leftNuid.length < 3) {
                return reply.code(400).send({
                    error: {
                        code: "INVALID_INPUT",
                        message: "Ungültige erste Spieler-ID."
                    }
                });
            }

            if (!rightNuid || rightNuid.length < 3) {
                return reply.code(400).send({
                    error: {
                        code: "INVALID_INPUT",
                        message: "Ungültige zweite Spieler-ID."
                    }
                });
            }

            if (leftNuid === rightNuid) {
                return reply.code(400).send({
                    error: {
                        code: "INVALID_INPUT",
                        message: "Bitte zwei unterschiedliche Spieler auswählen."
                    }
                });
            }

            const [
                leftTtrResult,
                rightTtrResult,
                leftHistoryResult,
                rightHistoryResult
            ] = await Promise.all([
                getPlayerTtr({
                    requestingUserId,
                    nuid: leftNuid
                }),
                getPlayerTtr({
                    requestingUserId,
                    nuid: rightNuid
                }),
                getPlayerTtrHistory({
                    requestingUserId,
                    nuid: leftNuid
                }),
                getPlayerTtrHistory({
                    requestingUserId,
                    nuid: rightNuid
                })
            ]);

            const left = buildPlayerSnapshot({
                nuid: leftNuid,
                ttrResult: leftTtrResult,
                historyResult: leftHistoryResult
            });

            const right = buildPlayerSnapshot({
                nuid: rightNuid,
                ttrResult: rightTtrResult,
                historyResult: rightHistoryResult
            });

            const comparison = buildComparison(left, right);

            let headToHead:
                | {
                available: boolean;
                perspective: {
                    requestedLeftNuid: string;
                    requestedRightNuid: string;
                    upstreamOtherUser: string;
                    note: string;
                };
                stats: ReturnType<typeof buildHeadToHeadStats>;
                items: unknown[];
                error: unknown | null;
            }
                | null = null;

            const otherUser = toHeadToHeadOtherUser(rightNuid);

            try {
                const headToHeadResult = await getPlayerHeadToHead({
                    requestingUserId,
                    otherUser
                });

                const items = Array.isArray(headToHeadResult.data)
                    ? headToHeadResult.data
                    : [];

                headToHead = {
                    available: !hasAuthError(headToHeadResult),
                    perspective: {
                        requestedLeftNuid: leftNuid,
                        requestedRightNuid: rightNuid,
                        upstreamOtherUser: otherUser,
                        note:
                            "myTischtennis liefert Head-to-Head nur aus Sicht des eingeloggten myTischtennis-Users gegen other_user. Dieser Block passt also nur exakt zum Paar, wenn die erste NUID dem eingeloggten myTischtennis-User entspricht."
                    },
                    stats: buildHeadToHeadStats(items),
                    items,
                    error: headToHeadResult.error ?? null
                };
            } catch (error) {
                request.log.warn(
                    {
                        error: errorToResponse(error),
                        leftNuid,
                        rightNuid
                    },
                    "Player compare head-to-head unavailable"
                );

                headToHead = {
                    available: false,
                    perspective: {
                        requestedLeftNuid: leftNuid,
                        requestedRightNuid: rightNuid,
                        upstreamOtherUser: otherUser,
                        note:
                            "Head-to-Head konnte nicht geladen werden. TTR- und History-Vergleich bleiben trotzdem verfügbar."
                    },
                    stats: buildHeadToHeadStats([]),
                    items: [],
                    error: errorToResponse(error)
                };
            }

            return {
                data: {
                    left,
                    right,
                    comparison,
                    summary: buildSummary(left, right, comparison),
                    headToHead
                },
                meta: {
                    source: "upstream",
                    generatedAt: new Date().toISOString()
                }
            };
        } catch (error) {
            request.log.error(error);
            return handleApiError(error, reply);
        }
    });
}