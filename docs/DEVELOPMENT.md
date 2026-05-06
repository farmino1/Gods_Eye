# Development Notes And Runbook

This document collects the local workflow details, common failure modes, and
layer-specific debugging shortcuts that are easy to forget while iterating on
the project.

## Local Commands

- `npm run dev`
  - starts Vite and the backend proxy together
- `npm run dev:client`
  - starts only the frontend
- `npm run dev:server`
  - starts only the backend
- `npm run lint`
  - fast safety check for syntax and lint regressions
- `npm test`
  - runs pure-logic Node tests
- `npm run build`
  - production build verification

## Useful Mental Model

The project is one app with two processes:

- the browser app on `5173`
- the backend proxy on `3001`

Most "it doesn't work" issues fall into one of these buckets:

- the browser code is stale
- the proxy process is stale
- the browser and proxy are on different code versions
- a provider request failed and the layer fell back
- the layer is gated by zoom or visibility rules

## Common Debugging Checks

### Weather is missing

Check:

1. Is the Weather master toggle enabled?
2. Are the specific sub-overlays enabled?
3. Is the backend `/api/weather` endpoint reachable?

### Ships are missing

Check:

1. Is the Ships layer enabled?
2. Is `AISSTREAM_API_KEY` configured?
3. Is the backend connected and receiving stream messages?
4. Is the camera pointed at an area that should currently contain vessels?

### Cameras are missing

Check:

1. Is the Cameras layer enabled?
2. Did the backend process restart after the `/api/cameras` route was added?
3. Does [`cameras/cameras.json`](../cameras/cameras.json) exist and contain active rows?
4. Are you zoomed to a level where the current viewport should show country, state, city, or individual camera items?
5. If clicking a camera does nothing, confirm the picked item is an individual camera, not an aggregate cluster that is supposed to zoom you further in.

### Aircraft replay looks empty

That can be correct. Aircraft rewind is session-only. If the app did not capture
aircraft snapshots while live, rewind has nothing truthful to show.

## Stale Process Problems

One of the easiest dev traps is restarting the client without restarting the
backend. Symptoms usually look like:

- a new `/api/...` route exists in `server/index.js`
- the browser still gets `404`
- tests and build pass

That normally means:

- the currently running proxy process is from an older code version

If that happens, restart the backend process, not just the browser tab.

## Testing Strategy

The repo does not currently include full browser E2E coverage. Instead it puts
tests around the pure logic that has the highest bug density:

- timeline math
- weather interpolation
- aircraft normalization
- ship normalization and AIS parsing
- camera viewport aggregation and catalog filtering

When adding a new layer behavior, prefer pulling complex logic into testable
helpers first.

## Rendering Strategy Notes

### Why some layers use Cesium entities

- satellites, aircraft, and ships have a manageable number of tracked objects
  after culling or prioritization
- object identity or material styling matters for those layers

### Why some layers use canvas overlays

- weather can explode into too many primitives if modeled as a large Cesium
  entity set
- a canvas overlay keeps that grid-heavy redraw work cheaper per frame

## Recommended Workflow For New Features

1. Decide the truth model first.
2. Normalize provider data into a stable service contract.
3. Keep credentials in the proxy.
4. Add tests for the non-visual logic.
5. Wire the layer into `Globe.jsx`.
6. Update docs, inline comments, and honesty copy before calling it done.
