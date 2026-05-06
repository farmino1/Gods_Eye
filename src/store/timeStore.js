import { create } from 'zustand'
import {
  DAY_MS,
  advanceTimeline,
  clampTimelineTime,
  createEmptySnapshotHistory,
  findNearestSnapshot,
  getSnapshotLayer,
  isLiveTimestamp,
  SNAPSHOT_LAYER_KEYS,
} from '../utils/timeline.js'

// The time store is the source of truth for both playback controls and
// session-captured snapshot history. Satellites and weather do not depend on
// these snapshots, but aircraft and ships do.
const RETAIN_MS = 3 * DAY_MS

function normalizeSnapshotEntry(snapshot) {
  if (!snapshot || !Number.isFinite(Number(snapshot.timestamp))) {
    return null
  }

  // Older code paths used per-layer names like `aircraftCatalog`; newer ones
  // use the generalized `catalog` field. The store accepts both so features can
  // evolve without breaking replay compatibility.
  const catalog = Array.isArray(snapshot.catalog)
    ? snapshot.catalog
    : Array.isArray(snapshot.aircraftCatalog)
      ? snapshot.aircraftCatalog
      : Array.isArray(snapshot.shipCatalog)
        ? snapshot.shipCatalog
        : null

  if (!catalog) {
    return null
  }

  return {
    timestamp: Number(snapshot.timestamp),
    catalog,
    source: snapshot.source ?? 'unknown',
    coverage: snapshot.coverage ?? 'session',
    bbox: snapshot.bbox ?? null,
  }
}

function normalizeSnapshotTarget(layerKeyOrSnapshot, maybeSnapshot) {
  if (
    typeof layerKeyOrSnapshot === 'string' &&
    SNAPSHOT_LAYER_KEYS.includes(layerKeyOrSnapshot)
  ) {
    return {
      layerKey: layerKeyOrSnapshot,
      snapshot: normalizeSnapshotEntry(maybeSnapshot),
    }
  }

  return {
    layerKey: 'aircraft',
    snapshot: normalizeSnapshotEntry(layerKeyOrSnapshot),
  }
}

const useTimeStore = create((set, get) => ({
  currentTime: Date.now(),
  isPlaying: true,
  speed: 1,
  liveMode: true,
  snapshotHistory: createEmptySnapshotHistory(),

  setCurrentTime: (time) =>
    set(() => {
      const nowMs = Date.now()
      const nextTime = clampTimelineTime(time, nowMs)

      return {
        currentTime: nextTime,
        liveMode: isLiveTimestamp(nextTime, nowMs),
        isPlaying: false,
      }
    }),

  setSpeed: (speed) =>
    set(() => ({
      speed: Number.isFinite(Number(speed)) ? Math.max(0.25, Number(speed)) : 1,
    })),

  tick: () =>
    set((state) => {
      if (!state.isPlaying) {
        return {}
      }

      const nextPlaybackState = advanceTimeline(state.currentTime, {
        nowMs: Date.now(),
        speed: state.speed,
      })

      return {
        currentTime: nextPlaybackState.currentTime,
        liveMode: nextPlaybackState.liveMode,
      }
    }),

  play: () =>
    set((state) => {
      const nowMs = Date.now()
      const nextTime = clampTimelineTime(state.currentTime, nowMs)

      return {
        currentTime: nextTime,
        liveMode: isLiveTimestamp(nextTime, nowMs),
        isPlaying: true,
      }
    }),
  pause: () => set(() => ({ isPlaying: false })),
  jumpToLive: () =>
    set(() => ({
      currentTime: Date.now(),
      liveMode: true,
      isPlaying: true,
    })),

  addSnapshot: (layerKeyOrSnapshot, maybeSnapshot) =>
    set((state) => {
      const normalizedTarget = normalizeSnapshotTarget(
        layerKeyOrSnapshot,
        maybeSnapshot,
      )

      if (!normalizedTarget.snapshot) {
        return {}
      }

      // Snapshot history is kept bounded in time so the session store remains
      // useful without growing forever during long-lived dev sessions.
      const cutoff = Date.now() - RETAIN_MS
      const nextLayerSnapshots = getSnapshotLayer(
        state.snapshotHistory,
        normalizedTarget.layerKey,
      )
        .filter(
          (item) => item.timestamp !== normalizedTarget.snapshot.timestamp,
        )
        .concat(normalizedTarget.snapshot)
        .sort(
          (leftSnapshot, rightSnapshot) =>
            leftSnapshot.timestamp - rightSnapshot.timestamp,
        )

      return {
        snapshotHistory: {
          ...state.snapshotHistory,
          [normalizedTarget.layerKey]: nextLayerSnapshots.filter(
            (item) => item.timestamp >= cutoff,
          ),
        },
      }
    }),

  getSnapshots: (layerKey) => getSnapshotLayer(get().snapshotHistory, layerKey),

  getSnapshot: (layerKey, timestamp) =>
    findNearestSnapshot(
      getSnapshotLayer(get().snapshotHistory, layerKey),
      timestamp,
    ),
}))

export default useTimeStore
