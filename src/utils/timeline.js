export const SECOND_MS = 1_000
export const MINUTE_MS = 60 * SECOND_MS
export const HOUR_MS = 60 * MINUTE_MS
export const DAY_MS = 24 * HOUR_MS
export const TIMELINE_WINDOW_HOURS = 72
export const LIVE_MODE_THRESHOLD_MS = 10 * SECOND_MS
export const SNAPSHOT_LAYER_KEYS = ['aircraft', 'ships']

export function createEmptySnapshotHistory() {
  return {
    aircraft: [],
    ships: [],
  }
}

export function getSnapshotLayer(snapshotHistory, layerKey = 'aircraft') {
  if (Array.isArray(snapshotHistory)) {
    return layerKey === 'aircraft' ? snapshotHistory : []
  }

  if (!snapshotHistory || typeof snapshotHistory !== 'object') {
    return []
  }

  return Array.isArray(snapshotHistory[layerKey])
    ? snapshotHistory[layerKey]
    : []
}

export function getTimelineBounds(
  nowMs = Date.now(),
  windowHours = TIMELINE_WINDOW_HOURS,
) {
  const safeNowMs = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now()
  const safeWindowHours = Math.max(1, Number(windowHours) || TIMELINE_WINDOW_HOURS)

  return {
    minTime: safeNowMs - safeWindowHours * HOUR_MS,
    maxTime: safeNowMs,
  }
}

export function clampTimelineTime(
  value,
  nowMs = Date.now(),
  windowHours = TIMELINE_WINDOW_HOURS,
) {
  const { minTime, maxTime } = getTimelineBounds(nowMs, windowHours)
  const parsedValue = Number(value)

  if (!Number.isFinite(parsedValue)) {
    return maxTime
  }

  return Math.min(Math.max(parsedValue, minTime), maxTime)
}

export function isLiveTimestamp(
  timestampMs,
  nowMs = Date.now(),
  thresholdMs = LIVE_MODE_THRESHOLD_MS,
) {
  const safeTimestampMs = clampTimelineTime(timestampMs, nowMs)
  return nowMs - safeTimestampMs <= Math.max(0, Number(thresholdMs) || 0)
}

export function advanceTimeline(
  currentTimeMs,
  {
    nowMs = Date.now(),
    speed = 1,
    deltaMs = SECOND_MS,
    windowHours = TIMELINE_WINDOW_HOURS,
  } = {},
) {
  const safeSpeed = Number.isFinite(Number(speed))
    ? Math.max(0.25, Number(speed))
    : 1
  const safeDeltaMs = Number.isFinite(Number(deltaMs))
    ? Math.max(0, Number(deltaMs))
    : SECOND_MS
  const nextTime = clampTimelineTime(
    Number(currentTimeMs) + safeDeltaMs * safeSpeed,
    nowMs,
    windowHours,
  )

  return {
    currentTime: nextTime,
    liveMode: isLiveTimestamp(nextTime, nowMs),
  }
}

export function getPlaybackPercent(currentTimeMs, bounds) {
  const minTime = bounds?.minTime
  const maxTime = bounds?.maxTime

  if (!Number.isFinite(minTime) || !Number.isFinite(maxTime) || maxTime <= minTime) {
    return 100
  }

  return ((currentTimeMs - minTime) / (maxTime - minTime)) * 100
}

export function getSnapshotRange(snapshotHistory) {
  if (!Array.isArray(snapshotHistory) || snapshotHistory.length === 0) {
    return null
  }

  const sortedSnapshots = [...snapshotHistory].sort(
    (leftSnapshot, rightSnapshot) => leftSnapshot.timestamp - rightSnapshot.timestamp,
  )

  return {
    minTime: sortedSnapshots[0].timestamp,
    maxTime: sortedSnapshots[sortedSnapshots.length - 1].timestamp,
  }
}

export function findNearestSnapshot(snapshotHistory, timestampMs) {
  if (!Array.isArray(snapshotHistory) || snapshotHistory.length === 0) {
    return null
  }

  return snapshotHistory.reduce((bestMatch, candidateSnapshot) => {
    if (!bestMatch) {
      return candidateSnapshot
    }

    return Math.abs(candidateSnapshot.timestamp - timestampMs) <
      Math.abs(bestMatch.timestamp - timestampMs)
      ? candidateSnapshot
      : bestMatch
  }, null)
}

export function findSurroundingSnapshots(snapshotHistory, timestampMs) {
  if (!Array.isArray(snapshotHistory) || snapshotHistory.length === 0) {
    return {
      before: null,
      after: null,
    }
  }

  let before = null
  let after = null

  snapshotHistory.forEach((snapshot) => {
    if (snapshot.timestamp <= timestampMs) {
      if (!before || snapshot.timestamp > before.timestamp) {
        before = snapshot
      }
      return
    }

    if (!after || snapshot.timestamp < after.timestamp) {
      after = snapshot
    }
  })

  return {
    before,
    after,
  }
}

export function getCombinedSnapshotRange(snapshotHistory) {
  const combinedSnapshots = SNAPSHOT_LAYER_KEYS.flatMap((layerKey) =>
    getSnapshotLayer(snapshotHistory, layerKey),
  )

  return getSnapshotRange(combinedSnapshots)
}
