# TT Tracker Backend

This repository contains the backend for the **TTR Tracker** app.

The backend acts as a small Node.js/Fastify server between the mobile app and the unofficial myTischtennis data endpoints.  
It is used as a defensive proxy so that the app does not directly communicate with myTischtennis.

The backend is responsible for:

- handling requests from the frontend app
- forwarding selected requests to myTischtennis
- applying short cache TTLs
- adding basic rate-limit protection
- handling API errors in a controlled way
- keeping sensitive backend configuration outside of the mobile app
- avoiding systematic crawling or permanent mirroring of myTischtennis data

The matching frontend app can be found here:

[TTRTracker App](https://github.com/kiranfin/TTRTracker)

---

## Requirements

Before installing the backend, make sure the server has the following installed:

- Node.js
- npm
- Git

You can check this with:

```bash
node -v
npm -v
git --version
```

## Installation on a Server
1. Clone the repository:
```
git clone https://github.com/kiranfin/tt-tracker-backend.git
```
2. Go into the project folder:
```
cd tt-tracker-backend
```
3. Install the dependencies:
```
npm install
```
4. Copy the `.env.example` file to `.env`:
```
cp .env.example .env
```
## Starting the Backend Normally
Start the backend with:
```
npm run build
npm run start
```
## Updating the Backend Normal
Pull the latest changes:
```
git pull
```
Install new dependencies if needed:
```
npm install
```
Then start the backend again:
```
npm run build
npm run start
```
## Running the Backend with Forever
forever can be used to keep the backend running in the background on a server.
### Install Forever
```
npm install -g forever
```
### Start the Backend with Forever
```
forever start -a --uid tt-tracker-backend npm -- run start
```
This starts the backend in the background and gives the process the name: `tt-tracker-backend`

You can check running forever processes with:
```
forever list
```
### Stop the Backend with Forever
```
forever stop tt-tracker-backend
```