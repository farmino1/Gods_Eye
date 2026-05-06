# Architecture

This document explains how the running app is structured today, how each major
layer is wired, and where to look when a specific part of the system behaves
incorrectly.

## Top-Level Runtime Shape

The active application is a single Vite frontend plus one local Node proxy.

Primary entry points:

- Client bootstrap: [`src/main.jsx`](../src/main.jsx)
- App shell: [`src/App.jsx`](../src/App.jsx)
- Globe orchestration: [`src/components/Globe.jsx`](../src/components/Globe.jsx)
- Proxy entry: [`server/index.js`](../server/index.js)

The split of responsibility is intentional:

- the browser owns rendering, UI interaction, playback state, and selection
- the backend owns credentials, upstream normalization, proxy caching, and the
  AISStream websocket boundary

## Browser Architecture

### App Shell

[`src/App.jsx`](../src/App.jsx) defines the main layout:

- left sidebar for layer controls and selection details
- full-screen globe area
- footer timeline

### Globe Orchestration

[`src/components/Globe.jsx`](../src/components/Globe.jsx) is the lifecycle
owner for the Cesium viewer and all layer instances.

Responsibilities:

- initialize Cesium once
- choose terrain provider or fallback ellipsoid terrain
- create all layer controllers
- own the shared OpenFreeMap vector service used by road traffic
- wire global time changes into every layer
- synchronize layer visibility with Zustand UI state
- coordinate picking so only one object type stays selected at a time

The globe component is the main "composition root" of the frontend runtime.

### State Stores

[`src/store/useStore.js`](../src/store/useStore.js) owns UI-facing state:

- layer enablement
- weather overlay toggles
- selected object
- satellite cap and catalog counts

[`src/store/timeStore.js`](../src/store/timeStore.js) owns playback semantics:

- `currentTime`
- `isPlaying`
- `speed`
- `liveMode`
- `snapshotHistory`

The store is the authoritative replay boundary for aircraft and ships.

## Rendering Architecture By Layer

### Satellites

Main files:

- [`src/layers/satellites.js`](../src/layers/satellites.js)
- [`src/utils/orbit.js`](../src/utils/orbit.js)
- [`src/services/satellites.js`](../src/services/satellites.js)

Rendering model:

- Cesium billboards for active satellites
- computed orbit trails
- selection helper entities

### Aircraft

Main files:

- [`src/layers/aircraft.js`](../src/layers/aircraft.js)
- [`src/services/aircraft.js`](../src/services/aircraft.js)

Rendering model:

- Cesium billboards
- live interpolation between polls
- optional selected-aircraft path overlays in live mode

### Cameras

Main files:

- [`src/layers/cameras.js`](../src/layers/cameras.js)
- [`src/services/cameras.js`](../src/services/cameras.js)
- [`src/components/CameraPopup.jsx`](../src/components/CameraPopup.jsx)
- [`server/cameras.js`](../server/cameras.js)

Rendering model:

- Cesium point clusters for country, state, and city aggregation
- individual camera points only at close zoom
- selection opens a popup preview with feed metadata and an external-link escape hatch

### Ships

Main files:

- [`src/layers/ships.js`](../src/layers/ships.js)
- [`src/services/ships.js`](../src/services/ships.js)
- [`server/ships.js`](../server/ships.js)

Rendering model:

- Cesium billboards with heading-based rotation
- near-side visibility culling
- short-term interpolation and prediction between updates

### Weather

Main files:

- [`src/layers/weather/index.js`](../src/layers/weather/index.js)
- [`src/layers/weather/wind.js`](../src/layers/weather/wind.js)
- [`src/layers/weather/temperature.js`](../src/layers/weather/temperature.js)
- [`src/layers/weather/pressure.js`](../src/layers/weather/pressure.js)
- [`src/services/weather.js`](../src/services/weather.js)
- [`server/weather.js`](../server/weather.js)

Rendering model:

- layered canvas overlays, not Cesium entities

Overlay breakdown:

- wind: particle field
- temperature: semi-transparent rasterized grid shading
- pressure: contour segments generated with marching squares

### Buildings

Main files:

- [`src/layers/buildings.js`](../src/layers/buildings.js)

Rendering model:

- textured Google photorealistic 3D tiles
- auto-hidden once the camera moves beyond city-scale zoom
- visibility responds during camera movement so zooming out drops the heavy tiles quickly

### Road Traffic

Main files:

- [`src/layers/roads.js`](../src/layers/roads.js)
- [`src/services/roads.js`](../src/services/roads.js)
- [`src/services/roadTraffic.js`](../src/services/roadTraffic.js)

Rendering model:

- synthetic local car traffic routed over cached OpenFreeMap road geometry
- Cesium entities for moving cars
- shares the same vector tile cache as the building layer

## Why Some Layers Use Cesium Entities And Others Use Canvas

Entity-backed layers:

- satellites
- aircraft
- cameras
- ships
- road traffic

Canvas-backed layers:

- weather

Primitive-backed layers:

- buildings

## Backend Architecture

[`server/index.js`](../server/index.js) is the local proxy and route dispatcher.

Responsibilities:

- load `.env.local`
- expose normalized API endpoints
- cache provider responses when appropriate
- keep provider-specific complexity out of the browser

## Backend Provider Modules

### Aircraft Provider

[`server/aircraft.js`](../server/aircraft.js):

- resolves ADS-B Exchange vs OpenSky
- obtains OpenSky OAuth tokens when needed
- normalizes aircraft payloads into one compact browser-facing format

### Ship Provider

[`server/ships.js`](../server/ships.js):

- resolves whether AISStream is configured
- keeps a single websocket connection alive
- normalizes incoming AIS messages
- merges static and positional vessel updates into one recent vessel cache

### Camera Provider

[`server/cameras.js`](../server/cameras.js):

- lazy-loads the local `cameras/cameras.json` catalog
- filters inactive, ignored, or duplicate rows
- aggregates the visible viewport into country, state, city, or camera payloads
- caches snapped viewport responses so panning does not recompute every move

### Weather Provider

[`server/weather.js`](../server/weather.js):

- requests replay-aligned Open-Meteo weather
- normalizes the response into the shared weather grid shape
- falls back to a synthetic grid when external fetches fail

## Core Data Flows

### Live Aircraft Flow

1. Browser calls `/api/aircraft/states`
2. Proxy resolves provider and fetches latest states
3. Browser normalizes rows into aircraft objects
4. Aircraft layer reconciles or interpolates entries
5. Browser stores a session snapshot for replay

### Live Ship Flow

1. Browser calculates viewport bbox
2. Browser calls `/api/ships/states`
3. Backend updates desired AISStream subscription bbox
4. Backend filters recent vessel cache to the requested bbox
5. Browser reconciles ship entities and stores a ship snapshot

### Weather Flow

1. Browser picks the current replay-aligned weather hour
2. Browser calls `/api/weather?timestamp=<ms>`
3. Proxy serves a real or synthetic hourly weather payload
4. Weather controller fans the payload out to wind, temperature, and pressure overlays

### Camera Flow

1. Browser derives a horizon-aware viewport bbox and camera height
2. Browser calls `/api/cameras` with the current bbox and height
3. Backend chooses a viewport aggregation tier
4. Browser renders clusters or individual camera points for that tier
5. Clicking a camera opens the popup preview without leaving the globe

### Road Vector Flow

1. Globe creates one shared OpenFreeMap vector service
2. Road traffic asks that service to warm its near-camera viewport
3. The service fetches and caches vector tiles in the browser
4. Road traffic reads normalized road segments from the shared snapshot

## Replay Flow

For snapshot-based layers:

1. user scrubs the timeline
2. layer reads `currentTime` from the time store
3. layer finds surrounding snapshots for its own history bucket
4. layer interpolates between the before/after catalogs
5. layer reconciles visible rendered entries

Weather is the main exception because it is fetched directly by replay time.

## Caching Strategy

### Proxy

- aircraft: short TTL
- TLE: medium TTL
- weather: normalized-hour cache
- cameras: snapped viewport-response cache over the local camera catalog

### Browser

- session snapshot history for aircraft and ships
- in-memory live layer catalogs
- shared OpenFreeMap vector tile cache for road traffic

## Debugging Entry Points

If something is broken, start here:

- routing or stale process issues: [`server/index.js`](../server/index.js)
- camera aggregation or popup issues: [`server/cameras.js`](../server/cameras.js) and [`src/layers/cameras.js`](../src/layers/cameras.js)
- playback issues: [`src/store/timeStore.js`](../src/store/timeStore.js)
- weather redraw issues: [`src/layers/weather/index.js`](../src/layers/weather/index.js)
- ship streaming issues: [`server/ships.js`](../server/ships.js)
- globe/viewer lifecycle issues: [`src/components/Globe.jsx`](../src/components/Globe.jsx)
