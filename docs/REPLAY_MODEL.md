# Replay Model And Data Honesty

This project deliberately avoids presenting all layers as if they had the same
kind of historical truth. Different data sources support different time
semantics, so the replay system keeps those distinctions visible.

## Replay Classes

### Full Replay

Layers in this class can truthfully cover the full 72-hour timeline window.

- satellites
- weather

Why:

- satellites are recomputed from TLEs instead of fetched as point-in-time logs
- weather is requested by replay-aligned timestamp and cached by hour

### Session Replay Only

Layers in this class only replay what the current browser session captured.

- aircraft
- ships

Why:

- the app primarily observes live feeds, not a complete historical archive
- the browser records snapshots while the session is running
- scrubbing backwards uses those captured snapshots and interpolation between
  them

### Live Present-Time Only

Layers in this class are intentionally not replayed across the 72-hour window.

- traffic cameras
- prediction markets

Why:

- they represent the current catalog or live feed state rather than a replayable archive
- presenting them as historical would imply truth the app does not actually have

## Timeline Window

The canonical playback window is 72 hours.

Source:

- [`src/utils/timeline.js`](../src/utils/timeline.js)

Important behavior:

- the timeline clamps to `now - 72h` on the left edge
- the timeline clamps to `now` on the live edge
- timestamps close to `now` count as live mode

## Snapshot Storage

Snapshot storage lives in [`src/store/timeStore.js`](../src/store/timeStore.js).

Current shape:

```js
{
  aircraft: [],
  ships: [],
}
```

Each snapshot is normalized to:

```js
{
  timestamp,
  catalog,
  source,
  coverage,
  bbox,
}
```

Notes:

- aircraft snapshots typically do not need a bbox because the feed is global
- ship snapshots keep bbox context so rewind does not pretend to cover areas
  that were never observed
- weather does not use snapshot storage because weather can already be resolved
  directly by time

## Layer-Specific Replay Behavior

### Satellites

- live mode: positions are evaluated for the current time
- rewind mode: positions are evaluated for the scrubbed time
- no snapshot capture is required

### Weather

- live mode: fetches the replay-aligned hour bucket near "now"
- rewind mode: fetches the replay-aligned hour bucket for the selected time
- the weather controller fans one payload out to wind, temperature, and pressure

### Aircraft

- live mode:
  - fetch latest aircraft states from the proxy
  - keep a session snapshot history
  - interpolate short-term motion between live polls
- rewind mode:
  - find surrounding aircraft snapshots
  - interpolate between the two catalogs
  - show only what was captured

### Ships

- live mode:
  - fetch current viewport-filtered vessels from the proxy
  - keep session snapshots keyed by time
  - interpolate between updates
- rewind mode:
  - rebuild the visible catalog from surrounding captured snapshots
  - do not invent vessels for uncaptured windows

### Cameras

- live mode:
  - fetch the current viewport slice from the local camera catalog
  - aggregate by country, state, city, or individual camera rows depending on zoom
  - open feed previews and metadata in a popup for selected cameras
- rewind mode:
  - unchanged from live mode because the camera overlay is not a replayable timeline layer

## Why Bbox Matters For Ships

Aircraft are global enough in this app that one catalog can be meaningfully
sampled for the whole view. Ships are more viewport-bound because the backend
subscription and filtering are driven by the current camera family.

Because of that, recorded ship snapshots may only be valid for the viewport
family in which they were captured. The code keeps bbox metadata so rewind
remains bounded by actual observed coverage.

## Honesty Text In The UI

The UI intentionally communicates:

- satellites and weather have full replay coverage
- aircraft and ships rewind only what the session captured
- cameras and prediction markets are live present-time only

Those messages are not decorative. They are part of the product contract.
