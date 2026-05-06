# Earth App

Minimal instructions to prepare this repository for publishing on GitHub.

Quick start

- Copy `.env.example` to `.env.local` and populate any required keys (do not commit secrets):

```bash
cp .env.example .env.local
# edit .env.local and fill values
```

- Install and run locally:

```bash
npm ci
npm test
npm run dev
```

Preparing for GitHub

- Keep the repository private while you sanitize history and confirm secrets are not present.
- Run a quick secret scan locally before pushing:

```bash
grep -RIn --exclude-dir={node_modules,.git,.cache,dist} -E "API[_-]?KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|BEGIN RSA PRIVATE KEY|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY" . || true
```

- Identify large files (example found: `cameras/cameras.json`). Either remove them from the repo history, move them to a separate data repository, or track with Git LFS. To stop tracking a large file and keep it locally:

```bash
git rm --cached cameras/cameras.json
echo "cameras/cameras.json" >> .gitignore
git commit -m "Remove large data file from repo and ignore it"
```

Publishing steps (example using GitHub CLI)

```bash
# authenticate
gh auth login

# create private repo and push current branch
gh repo create YOUR-USER/your-repo --private --source=. --remote=origin --push
```

CI

This repository includes a minimal GitHub Actions workflow `.github/workflows/ci.yml` that runs `npm ci` and `npm test` on push and PRs.

Security notes

- If you find secrets in commit history, remove them with `git filter-repo` or BFG and rotate credentials.
- Store runtime secrets in the GitHub repository secrets UI or in your CI provider's secret store.

If you want, I can:

- add a LICENSE (MIT),
- run the secret scan and show matches, and
- prepare a git-filter-repo or BFG recipe to help scrub history.
# Air, Sea & Weather

`earth-app` is a Cesium-based globe focused on live air/sea/weather data plus
static near-camera 3D surface context, plus a separate live prediction-markets
view:

- orbital satellites
- live aircraft
- clustered live traffic cameras
- live ships
- multi-overlay weather
- photorealistic 3D buildings
- OpenFreeMap-derived road traffic
- Polymarket politics and geopolitics markets

The project is intentionally honest about replay coverage. Satellites and
weather can cover the full 72-hour window. Aircraft and ships only rewind what
the running session captured. Traffic cameras and prediction markets are live
present-time layers only.

## Feature Summary

### Satellites

- Source: CelesTrak TLE feed
- Rendering: Cesium billboards, orbit trails, and selection helpers
- Replay model: full 72-hour playback because positions are recomputed from TLEs

### Aircraft
-
- Source: OpenSky (authenticated access via `OPENSKY_CLIENT_ID`/`OPENSKY_CLIENT_SECRET`)
- Rendering: Cesium billboards, focused 3D models, and live-only session path overlays
- Replay model: session snapshots only

### Ships

- Source: AISStream through the backend websocket bridge when
  `AISSTREAM_API_KEY` is configured
- Rendering: Cesium billboards plus close or focused 3D ship models with
  short-term interpolation and camera-aware culling
- Replay model: session snapshots only

### Cameras

- Source: local [`cameras/cameras.json`](./cameras/cameras.json) catalog
- Rendering: viewport-driven clustering that steps from country to state to
  city to individual camera points, plus a popup preview and metadata card
- Replay model: live present-time catalog only

### Weather

- Source: Open-Meteo forecast and historical-forecast APIs through the proxy
- Overlays:
  - wind particles
  - temperature shading
  - pressure contours
- Rendering: canvas overlays layered over Cesium, not per-cell Cesium entities
- Replay model: full 72-hour hourly weather buckets

### Buildings

- Source: Cesium photorealistic 3D tiles
- Rendering: textured photorealistic 3D tiles that auto-hide beyond city-scale
  zoom so the globe stays responsive
- Replay model: static present-time context only

### Road Traffic

- Source: OpenFreeMap Liberty vector tiles in the browser
- Rendering: Cesium GLB car models routed over cached road geometry
- Replay model: synthetic present-time local traffic only

### Prediction Markets

- Source: Polymarket Gamma API through the local proxy
- Rendering: separate React page with politics and geopolitics category tabs
- Replay model: live present-time markets only

## Technology Stack

- React 19
- Vite 8
- Cesium
- Zustand
- Tailwind CSS
- Plain Node HTTP proxy
- Axios for HTTP

## Repository Layout

- [`src/`](./src): browser application code
- [`server/`](./server): local proxy, provider adapters, and response caching
- [`test/`](./test): lightweight Node tests for pure logic
- [`docs/`](./docs): architecture, API, and development notes
- [`public/`](./public): Cesium runtime assets and icons
- [`cameras/`](./cameras): local scraped camera catalog and scraper state

## Running Locally

### Prerequisites

- Node.js 24 or newer is recommended in this workspace
- npm

### First Run

1. Install dependencies with `npm install`.
2. Copy [`.env.example`](./.env.example) to `.env.local`.
3. Add only the credentials you actually want to use.
4. Start the app with `npm run dev`.
5. Open `http://127.0.0.1:5173`.

If you change `.env.local` while the app is already running, restart the backend
process so the proxy picks up the new credentials.

The default development ports are:

- Vite client: `5173`
- Node proxy: `3001`

The Vite dev server proxies `/api/*` requests to the local Node process.

## Environment Configuration

The important variables are:

- `SATELLITE_API_PORT`: backend port, defaults to `3001`

- `AIRCRAFT_DATA_PROVIDER`: `opensky`
- `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET`: enables authenticated OpenSky
- `AISSTREAM_API_KEY`: enables live ship streaming through the proxy
- `VITE_CESIUM_ION_TOKEN`: enables Cesium ion-backed photorealistic 3D tiles


See [`.env.example`](./.env.example) and [`docs/API.md`](./docs/API.md) for the
full details.

## Scripts

- `npm run dev`: starts Vite and the Node proxy together
- `npm run dev:client`: starts only the frontend
- `npm run dev:server`: starts only the proxy
- `npm run lint`: runs ESLint
- `npm run test`: runs the Node test suite
- `npm run build`: creates a production build
- `npm run preview`: previews the production bundle

## Truth And Replay Model

This project does not flatten every layer into one fake notion of "historical".
Each layer has its own truth model:

| Layer | Source | Replay coverage | Notes |
| --- | --- | --- | --- |
| Satellites | TLE propagation | Full 72h window | Calculated positions |
| Weather | Open-Meteo hourly buckets | Full 72h window | Queryable by time |
| Aircraft | Live aircraft feeds | Session only | Uses captured snapshots |
| Ships | Live AIS stream | Session only | Uses captured snapshots |

See [`docs/REPLAY_MODEL.md`](./docs/REPLAY_MODEL.md) for the detailed rules.

## Architecture Overview

The important runtime entry points are:

- App shell: [`src/App.jsx`](./src/App.jsx)
- Globe orchestration: [`src/components/Globe.jsx`](./src/components/Globe.jsx)
- Camera popup: [`src/components/CameraPopup.jsx`](./src/components/CameraPopup.jsx)
- Timeline UI: [`src/components/Timeline.jsx`](./src/components/Timeline.jsx)
- UI state: [`src/store/useStore.js`](./src/store/useStore.js)
- Playback state: [`src/store/timeStore.js`](./src/store/timeStore.js)
- Proxy entry point: [`server/index.js`](./server/index.js)

Layer implementations live in:

- [`src/layers/satellites.js`](./src/layers/satellites.js)
- [`src/layers/aircraft.js`](./src/layers/aircraft.js)
- [`src/layers/cameras.js`](./src/layers/cameras.js)
- [`src/layers/buildings.js`](./src/layers/buildings.js)
- [`src/layers/roads.js`](./src/layers/roads.js)
- [`src/layers/ships.js`](./src/layers/ships.js)
- [`src/layers/weather/index.js`](./src/layers/weather/index.js)

The detailed walkthrough is in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## API Surface

The local backend exposes:

- `GET /api/health`
- `GET /api/satellites/tle`
- `GET /api/aircraft/states`
- `GET /api/weather?timestamp=<ms>`
- `GET /api/cameras`
- `GET /api/ships/states?bbox=<west,south,east,north>`
- `GET /api/predictions/markets`

Detailed request and response shapes are documented in
[`docs/API.md`](./docs/API.md).

## Development Notes

- Cesium is the heaviest dependency, so the globe is lazy-loaded.
- Weather responses are cached by normalized playback hour.
- Aircraft and ship snapshots are retained in the session playback store for
  three days.
- Camera overlays are fetched by viewport and clustered server-side so the app
  never tries to render the full 100k+ catalog at once.
- If a newly added endpoint appears to return `404` in development, check
  whether Vite is still talking to a stale backend process on port `3001`.

## Documentation Index

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md): runtime architecture and layer responsibilities
- [`docs/API.md`](./docs/API.md): backend endpoints, env vars, and payload shapes
- [`docs/ASSET_ATTRIBUTION.md`](./docs/ASSET_ATTRIBUTION.md): third-party 3D model sources and licenses
- [`docs/REPLAY_MODEL.md`](./docs/REPLAY_MODEL.md): playback honesty rules and snapshot semantics
- [`docs/DEVELOPMENT.md`](./docs/DEVELOPMENT.md): runbook, debugging tips, and local workflow notes
