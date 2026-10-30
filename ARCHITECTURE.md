# Architecture

The backend is a defensive proxy for myTischtennis (myTT). The main goal is to send as few requests to
myTT as possible and to always have an answer, even when myTT is slow, down or blocking the server IP.

## Layers

The direction is fixed, nothing takes a shortcut:

```
routes -> services -> cache | (mytt -> upstream)
```

```
src/
  routes/       HTTP only: validate input, call a service, send { data, meta }
  services/     one module per area (search, club, league, team, meeting, rating, events, ...):
                build the cache key, read through the cache with a policy, build the meta
  policies.ts   one table: DataKind -> freshness, stale limit, empty handling, priority
  cacheKeys.ts  every cache key builder
  cache/        ResilientCache (in-flight dedupe, stale fallback), persistence to data/cache.json
  mytt/         source layer: fetch, parse, validate with zod. No cache, no session handling
  sources/      fallback helpers (fetchWithFallback, html/ page parsing), plausibility checks
  upstream/     the only way to myTT: queue, rate window, circuit breakers, challenge detection
  store/        SQLite (finished match reports, opponent ratings)
```

`test/architecture.test.ts` enforces the rules that are easy to break:

- `routes/` imports nothing from `mytt/`, `upstream/`, `cache/` and not `utils/responseMeta`
- `mytt/` imports nothing from `cache/`, `services/`, `routes/`
- `upstream/` and `cache/` do not import upwards

A route that needs something from myTT asks a service. If a service needs a value from the cache inside a
source function (for example the resolved Andro club number), it passes a small store into the `mytt/`
function (`ResolvedAndroClubNrStore`), the source layer itself never sees the cache.

## Data policies

`src/policies.ts` is the only place where TTLs live. Each `DataKind` has a `Policy`:

| Field        | Meaning                                                                          |
|--------------|----------------------------------------------------------------------------------|
| `fresh`      | How long an entry is served straight from the cache. A function can decide by value (live match: 60 s, planned: until it starts, completed: 7 days) |
| `schedule`   | Refresh by match schedule: fresh until the end of the next match in the data (start plus 3 hours), capped at `max` (24 h, club schedule 12 h). While a match is running, every 10 minutes. Table and balances have no dates and take the window from the cached schedule of the same league or team (without it they keep `fresh`) |
| `isEmpty`    | Marks an empty result (season not started, format moved). Held for `emptyFresh` (default 2 minutes) at most |
| `staleMax`   | How long an expired entry stays usable: as answer for stale-while-revalidate and as fallback when myTT fails |
| `swr`        | Serve an expired entry at once and refresh it in the background. Off for live data (matches) and the personal TTR paths |
| `priority`   | Queue priority of the load, `interactive` or `background`                        |

Services call `readByPolicy({ kind, key, load })` (`services/read.ts`). It returns `{ value, meta }`, the
route sends `{ data: value, meta }`. `meta` has `source` (`cache`, `upstream`, `html`, `stale`), `origin` and
`fetchedAt`, plus extra fields where a route needs them.

## Stale-while-revalidate

Only a real cache miss waits for myTT. An expired entry that is still within `staleMax` is returned
immediately (`source: "cache"` with its real `fetchedAt`), and one refresh runs in the background through
the queue (`runInBackground`, in-flight dedupe, so many readers cause one request). If the refresh fails
the old entry stays and the source is retried after `CACHE_FAILED_LOAD_RETRY_MS` (answers then say `stale`).

Work nobody waits for goes through `services/jobs.ts` (one job per key, one after another, background
priority): missing club logos (`/api/clubs/logos` only answers from the cache and lists the rest in
`meta.pending`) and the search for the Andro club number. Nothing is planned during a challenge or
when the background budget is used up.

## Personal data and sharing

Data that needs a myTT login is fetched by the phone only, with the cookie on the device. The server holds
no cookie for the new app versions. When a user shares their rating with another app user (a grant), the
phone uploads the last data it got from myTT as a snapshot:

- `PUT /api/me/mytt/snapshots` takes the raw myTT history (checked against `PlayerTtrHistoryResponseSchema`),
  at most once an hour per user (a new grant lifts the limit once), only while a live grant exists, size
  limited. The first upload binds the user to that player id, another id needs `replacePlayer`.
- `GET /api/shared/players/:nuid` returns the snapshot to a receiver whose grant allows it:
  `ttr:read` gives the current rating, `ttr_history:read` the history. Always with `fetchedAt` and the owner name.
- The snapshot is deleted as soon as the last grant is revoked or expired.
- Grants live in SQLite (`store/grantStore.ts`), snapshots in `store/snapshotStore.ts`, the rules in
  `services/snapshots.ts`. Grants from the old `data/mytt-sessions.json` are imported on first start.

The old server cookie routes (`/api/me/mytt/cookie`, `/ttr`, `/ttr-history`, `/head-to-head`, `/compare`) stay
for old app versions during the transition and are removed afterwards.

## Adding a new kind of data

1. **Source** in `mytt/`: fetch with `getJsonFromMytt` / `getRouteDataWithHtmlFallback`, no caching.
2. **Schema** in `schemas.ts` (zod). Add a plausibility check in `sources/validate.ts` if wrong data could look valid.
3. **Policy** in `policies.ts` (new `DataKind`) and a key builder in `cacheKeys.ts`. Add a line to `test/policies.test.ts`.
4. **Service** in `services/` that calls `readByPolicy`, then a **route** in `routes/` that validates input,
   calls the service and sends the result. Errors go through `handleApiError`.

## Upstream protection

Everything that reaches myTT goes through `upstream/fetch.ts`:

- a queue with limited parallelism and spacing, user requests go before background work
- a rolling 30 minute budget (`MYTT_BUDGET_PER_30MIN`, default 90 of myTT's 360). Background work may use
  60 percent of it (`MYTT_BACKGROUND_SHARE`), the rest is left for cache misses a user waits for
- throttle: 2 requests in parallel, at least 1 second apart (background work takes at most one slot)
- one circuit breaker per lane (`api` and `site`)
- a real quota 429 (with `ratelimit` header) pauses both lanes until the window resets
- a redirect to `/verify` (captcha) is a challenge, not a rate limit: both lanes pause for 6 hours, then
  exactly one probe request goes out, every new challenge doubles the pause up to 24 hours
- the canary runs at most daily and is skipped during a challenge, with an open breaker or a tight budget
- `/debug/status` shows breaker state, queue, budget, cache, store, background jobs and the challenge state. Under `data` it breaks the cache and the budget down per data kind: entries, fresh and stale count, age, the next refresh and how many upstream requests the kind caused in the last 30 minutes (interactive and background). `services/read.ts` tags every load with its kind (`upstream/dataKind.ts`) for that
- the request log (`logs/requests.jsonl`) rotates at 20 MB, three old files are kept
