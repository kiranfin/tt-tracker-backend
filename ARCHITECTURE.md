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
| `fresh`      | How long an entry is served straight from the cache. A function can decide by value (live match: 30 s, completed: 7 days) |
| `isEmpty`    | Marks an empty result (season not started, format moved). Held for `emptyFresh` (default 2 minutes) at most |
| `staleMax`   | How old an expired entry may be and still be served when myTT fails. Evaluated per kind from Phase 2 on, until then the global `CACHE_STALE_MAX_AGE_MS` applies |
| `priority`   | Queue priority of the load, `interactive` or `background`                        |

Services call `readByPolicy({ kind, key, load })` (`services/read.ts`). It returns `{ value, meta }`, the
route sends `{ data: value, meta }`. `meta` has `source` (`cache`, `upstream`, `html`, `stale`), `origin` and
`fetchedAt`, plus extra fields where a route needs them.

## Adding a new kind of data

1. **Source** in `mytt/`: fetch with `getJsonFromMytt` / `getRouteDataWithHtmlFallback`, no caching.
2. **Schema** in `schemas.ts` (zod). Add a plausibility check in `sources/validate.ts` if wrong data could look valid.
3. **Policy** in `policies.ts` (new `DataKind`) and a key builder in `cacheKeys.ts`. Add a line to `test/policies.test.ts`.
4. **Service** in `services/` that calls `readByPolicy`, then a **route** in `routes/` that validates input,
   calls the service and sends the result. Errors go through `handleApiError`.

## Upstream protection

Everything that reaches myTT goes through `upstream/fetch.ts`:

- a queue with limited parallelism and spacing, user requests go before background work
- a counted request window (emergency brake) and one circuit breaker per lane (`api` and `site`)
- a real quota 429 (with `ratelimit` header) pauses both lanes until the window resets
- a redirect to `/verify` (captcha) is a challenge, not a rate limit: both lanes pause for 6 hours, then
  exactly one probe request goes out, every new challenge doubles the pause up to 24 hours
- `/debug/status` shows breaker state, queue, cache, store and the challenge state
