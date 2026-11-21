# TT Tracker Backend

This repository contains the backend for the **TTR Tracker** app.

The backend acts as a small Node.js/Fastify server between the mobile app and the unofficial myTischtennis data endpoints. It serves as a defensive proxy to ensure that the app does not directly communicate with myTischtennis.

### ⚠️ Disclaimer ⚠️

This repository was developed quickly and is still a work in progress. It is not finished and may contain errors, bugs, incomplete features, or unstable behavior.

Use it at your own risk. Contributions, feedback, and improvements are welcome.

## Table of Contents
- [Responsibilities](#responsibilities)
- [Requirements](#requirements)
- [Installation on a Server](#installation-on-a-server)
- [Running the Backend with Docker](#running-the-backend-with-docker)
- [Updating the Backend](#updating-the-backend)
- [Switching from Forever to Docker](#switching-from-forever-to-docker)
- [Local Development](#local-development)
- [Operations](#operations)

---

## Responsibilities 📋

The backend is responsible for:

- Handling requests from the frontend app
- Forwarding selected requests to myTischtennis
- Caching public data and refreshing it by match schedule, in the background (stale-while-revalidate)
- Staying within a rolling request budget (`MYTT_BUDGET_PER_30MIN`) and pausing when myTischtennis blocks the server IP
- Letting the app fetch cache misses from myTischtennis itself (**device relay**, `x-tt-relay: 1`, `POST /api/relay`), so the server IP sends almost no requests; the backend still builds the URLs, parses, validates and caches
- Falling back to the myTischtennis website for some data (league table, schedules, match report) when the JSON API is down
- Handling API errors in a controlled way, so the app can show the last known data with its age
- Storing snapshots that users share with other app users (the phone fetches personal data, not the server)
- Keeping sensitive backend configuration outside of the mobile app
- Avoiding systematic crawling or permanent mirroring of myTischtennis data

How it is built, which rules the cache follows and how to add a new kind of data is described in [ARCHITECTURE.md](ARCHITECTURE.md).

The matching frontend app can be found here:  
[TTRTracker App](https://github.com/kiranfin/TTRTracker)

---

## Requirements ⚙️

On the server you need:

- **Docker** with the **Compose plugin** (`docker compose`)
- **Git**

You can check this with:

```bash
docker --version
docker compose version
git --version
```

Node.js and npm are only needed for local development.

---

## Installation on a Server 🚀

1. Clone the repository and go into the project folder:
   ```bash
   git clone https://github.com/kiranfin/tt-tracker-backend.git
   cd tt-tracker-backend
   ```

2. Copy the `.env.example` file to `.env` and fill in the secrets:
   ```bash
   cp .env.example .env
   ```

3. Create the data folders and give them to the container user (`node`, uid 1000):
   ```bash
   mkdir -p data logs
   sudo chown -R 1000:1000 data logs
   ```

4. Build and start the container:
   ```bash
   docker compose up -d --build
   ```

The container is published on `127.0.0.1:${PORT}` of the host (default 4001), so it stays behind the reverse proxy. `HOST` from `.env` is ignored inside the container. `data/` (users, sessions, `store.db`, `cache.json`) and `logs/` are mounted from the project folder and survive rebuilds.

---

## Running the Backend with Docker 🐳

```bash
docker compose up -d --build   # build and start (or apply code changes)
docker compose ps              # status incl. health check (GET /health)
docker compose logs -f         # follow the server log
docker compose restart         # restart, e.g. after editing .env
docker compose down            # stop (the cache is saved to data/cache.json first)
```

The container restarts automatically after a crash or a server reboot (`restart: unless-stopped`).

---

## Updating the Backend 🔄

```bash
git pull
docker compose up -d --build
```

The image builds `dist/` from the current source, so a `git pull` can never leave an old build running. Remove old images now and then with `docker image prune`.

---

## Switching from Forever to Docker 🔁

Run this once on the server, in the project folder:

1. Pull the latest code: `git pull`
2. Stop the old process: `forever stop tt-tracker-backend` (it saves the cache to `data/cache.json` on exit). Check with `forever list` that nothing is left.
3. Give the existing data to the container user: `sudo chown -R 1000:1000 data logs`
4. Start the container: `docker compose up -d --build`
5. Check it: `docker compose ps` should show `healthy`, and `curl http://127.0.0.1:4001/health` should return `{"ok":true,...}`.

The reverse proxy does not need to change as long as `PORT` in `.env` stays the same. If something goes wrong, run `docker compose down` and start forever again as before. Once Docker runs fine, remove forever with `npm uninstall -g forever`.

---

## Local Development

For testing the app on a phone against your PC, run without Docker:

```bash
npm install
npm run dev
```

Set `HOST=0.0.0.0` in `.env` so the backend is reachable in your Wi-Fi. This restarts automatically on file changes. A production build without Docker runs with `npm run start` (builds `dist/` first).

---

## Operations 🛠️

- **Status:** `GET /debug/status` with the header `x-api-key` (`TTTRACKER_API_KEY`). It shows the challenge state (`challenge`), the queue and breakers (`rateLimit`), the budget per data kind (`data`: entries, age, next refresh and requests of the last 30 minutes), background jobs, cache, store, the device relay counters (`relay`) and the last canary report.
- **Device relay:** `RELAY_ENABLED=false` switches it off immediately. Check `relay.served` in `/debug/status` and `mytt_relay_served` / `mytt_relay_upload` in the request log. `RELAY_REQUIRE_AUTH=true` limits uploads to logged-in users. `RELAY_LOGO_HEADS_PER_CALL` (default `3`, `0` = off) caps how many club logos one `/api/clubs/logos` call fetches through the phone; `RELAY_MIN_MAX_AGE_MS` (default `300000`) is the shortest data age the app may request with `x-tt-max-age`, which only applies to relay requests. Every request to myTischtennis counts against the quota, including `/api/ttr/*`.
- **If myTischtennis blocks the server IP** (redirect to `/verify`, a captcha page): the backend pauses all requests for 6 hours, then sends a single probe and doubles the pause on every new challenge (up to 24 hours). The app keeps showing cached data. The captcha is never solved or bypassed; reduce traffic and contact myTischtennis. Test the behaviour locally with `MYTT_FORCE_CHALLENGE=true`.
- **Request log:** `logs/requests.jsonl` is rotated at 20 MB and the last 3 files are kept (`TTTRACKER_LOG_MAX_BYTES`, `TTTRACKER_LOG_KEEP_FILES`). Count upstream requests with `type: "mytt_upstream_request"`.
- **After a deploy:** check that `docker compose ps` shows the container as `healthy` and that `docker compose logs` shows the new start.
