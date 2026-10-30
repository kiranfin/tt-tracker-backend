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
- [Starting the Backend Normally](#starting-the-backend-normally)
- [Updating the Backend](#updating-the-backend)
- [Running the Backend with Forever](#running-the-backend-with-forever)
- [Operations](#operations)

---

## Responsibilities 📋

The backend is responsible for:

- Handling requests from the frontend app
- Forwarding selected requests to myTischtennis
- Caching public data and refreshing it by match schedule, in the background (stale-while-revalidate)
- Staying within a rolling request budget (`MYTT_BUDGET_PER_30MIN`) and pausing when myTischtennis blocks the server IP
- Handling API errors in a controlled way, so the app can show the last known data with its age
- Storing snapshots that users share with other app users (the phone fetches personal data, not the server)
- Keeping sensitive backend configuration outside of the mobile app
- Avoiding systematic crawling or permanent mirroring of myTischtennis data

How it is built, which rules the cache follows and how to add a new kind of data is described in [ARCHITECTURE.md](ARCHITECTURE.md).

The matching frontend app can be found here:  
[TTRTracker App](https://github.com/kiranfin/TTRTracker)

---

## Requirements ⚙️

Before installing the backend, ensure that the server has the following installed:

- **Node.js**
- **npm**
- **Git**

You can check this with:

```bash
node -v
npm -v
git --version
```

---

## Installation on a Server 🚀

1. Clone the repository:
   ```bash
   git clone https://github.com/kiranfin/tt-tracker-backend.git
   ```

2. Go into the project folder:
   ```bash
   cd tt-tracker-backend
   ```

3. Install the dependencies:
   ```bash
   npm install
   ```

4. Copy the `.env.example` file to `.env`:
   ```bash
   cp .env.example .env
   ```

---

## Starting the Backend Normally 🔄

Start the backend with:

```bash
npm run build
npm run start
```

### Local Development

For testing the app on a phone against your PC, set `HOST=0.0.0.0` in `.env` so the backend is reachable in your Wi-Fi, then run:

```bash
npm run dev
```

This restarts automatically on file changes. On the server keep the default `HOST=127.0.0.1` behind the reverse proxy.

---

## Updating the Backend 🔄

To pull the latest changes:

```bash
git pull
```

Install new dependencies if needed:

```bash
npm install
```

Then start the backend again:

```bash
npm run start
```

`npm run start` builds `dist/` first (`prestart`), so a `git pull` can no longer leave the server running an old build.

---

## Running the Backend with Forever 🌙

Forever can be used to keep the backend running in the background on a server.

### Install Forever

```bash
npm install -g forever
```

### Start the Backend with Forever

```bash
forever start -a --uid tt-tracker-backend npm -- run start
```

This command starts the backend in the background and assigns it the process name: `tt-tracker-backend`.

You can check running forever processes with:

```bash
forever list
```

### Stop the Backend with Forever

```bash
forever stop tt-tracker-backend
```

---

## Operations 🛠️

- **Status:** `GET /debug/status` with the header `x-api-key` (`TTTRACKER_API_KEY`). It shows the challenge state (`challenge`), the queue and breakers (`rateLimit`), the budget per data kind (`data`: entries, age, next refresh and requests of the last 30 minutes), background jobs, cache, store and the last canary report.
- **If myTischtennis blocks the server IP** (redirect to `/verify`, a captcha page): the backend pauses all requests for 6 hours, then sends a single probe and doubles the pause on every new challenge (up to 24 hours). The app keeps showing cached data. The captcha is never solved or bypassed; reduce traffic and contact myTischtennis. Test the behaviour locally with `MYTT_FORCE_CHALLENGE=true`.
- **Request log:** `logs/requests.jsonl` is rotated at 20 MB and the last 3 files are kept (`TTTRACKER_LOG_MAX_BYTES`, `TTTRACKER_LOG_KEEP_FILES`). Count upstream requests with `type: "mytt_upstream_request"`.
- **After a deploy:** check that `dist/` was rebuilt (`npm run start` builds first) and that the `forever` log shows the new start.
