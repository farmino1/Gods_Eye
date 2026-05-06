# API Reference

This document describes the local backend routes exposed by
[`server/index.js`](../server/index.js) and the environment variables that
affect them.

## Environment Variables

### Core

- `SATELLITE_API_PORT`
  - optional
  - defaults to `3001`
  - controls which port the local proxy listens on

### Aircraft

- `AIRCRAFT_DATA_PROVIDER`
  - optional
  - allowed values: `opensky`

- `OPENSKY_CLIENT_ID`
  - optional
  - enables authenticated OpenSky access

- `OPENSKY_CLIENT_SECRET`
  - optional
  - paired with `OPENSKY_CLIENT_ID`

### Ships

- `AISSTREAM_API_KEY`
  - optional
  - enables the AISStream websocket bridge used by the ship layer

### Cameras

The camera overlay uses the local scraped catalog in
[`cameras/cameras.json`](../cameras/cameras.json). It does not require
environment variables.

### Frontend Building Rendering

These variables affect the browser building layer rather than the local proxy:

- `VITE_CESIUM_ION_TOKEN`
  - optional
  - enables Cesium ion-backed photorealistic 3D tiles in the browser

## Routes

### `GET /api/health`

Simple health probe.

Example response:

```json
{
  "ok": true
}
```

### `GET /api/satellites/tle`

Returns raw TLE text from the backend cache.

Notes:

- the backend caches TLE text for 30 minutes
- the response is `text/plain`

### `GET /api/aircraft/states`

Returns a normalized aircraft payload.

Example response shape:

```json
{
  "source": "opensky",
  "generatedAt": 1767225600000,
  "states": []
}
```

Notes:

- the backend keeps a short cache so bursty refreshes do not hammer the live
  provider
- when a fetch fails but a cached payload exists, the proxy can serve the stale
  payload instead of failing hard

### `GET /api/weather?timestamp=<ms>`

Returns the replay-aligned weather payload nearest the requested time.

Example response shape:

```json
{
  "source": "open-meteo-forecast",
  "generatedAt": 1767225600000,
  "timestamp": 1767225600000,
  "grid": {}
}
```

Notes:

- weather is normalized to hourly buckets
- the backend caches normalized-hour responses
- when provider fetches fail, the backend can return a synthetic fallback grid

### `GET /api/cameras`

Returns the visible camera slice for the requested viewport.

Accepted query params:

- `bbox=<west,south,east,north>`
- `height=<meters>`

`GET /api/cameras/viewport` is accepted as an alias for the same handler.

Example response shape:

```json
{
  "source": "local-cameras",
  "generatedAt": 1767225600000,
  "level": "state",
  "totalCameraCount": 139692,
  "visibleCameraCount": 812,
  "itemCount": 12,
  "items": []
}
```

Notes:

- the backend lazily loads the local camera catalog from disk
- unusable rows are filtered out before viewport aggregation
- the response level steps through `country`, `state`, `city`, and `camera`
- viewport responses are cached by snapped bbox and aggregation tier

### `GET /api/ships/states?bbox=<west,south,east,north>`

Returns ships filtered to the requested bbox.

Example response shape:

```json
{
  "source": "aisstream",
  "generatedAt": 1767225600000,
  "bbox": {
    "west": -10,
    "south": 45,
    "east": 10,
    "north": 60
  },
  "ships": []
}
```

Notes:

- when AISStream is configured, the backend keeps one websocket connection open
- the browser only receives viewport-filtered recent vessels

### `GET /api/predictions/markets`

Returns normalized Polymarket markets grouped into politics and geopolitics.

Example response shape:

```json
{
  "source": "polymarket",
  "generatedAt": 1767225600000,
  "categories": [
    {
      "key": "politics",
      "label": "Politics",
      "tagSlug": "politics",
      "events": []
    },
    {
      "key": "geopolitics",
      "label": "Geopolitics",
      "tagSlug": "geopolitics",
      "events": []
    }
  ]
}
```

Notes:

- the backend uses the public Polymarket Gamma API
- markets are grouped by the `politics` and `geopolitics` Polymarket tag slugs
- each event is normalized down to a primary live market snapshot for UI display

## Snapshot History Shape

Snapshot history is stored in the browser, not exposed as an API route, but the
shape matters for debugging playback:

```json
{
  "aircraft": [],
  "ships": []
}
```
