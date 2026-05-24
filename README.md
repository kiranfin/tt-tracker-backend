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

---

## Responsibilities 📋

The backend is responsible for:

- Handling requests from the frontend app
- Forwarding selected requests to myTischtennis
- Applying short cache TTLs
- Adding basic rate-limit protection
- Handling API errors in a controlled way
- Keeping sensitive backend configuration outside of the mobile app
- Avoiding systematic crawling or permanent mirroring of myTischtennis data

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
npm run build
npm run start
```

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