import assert from 'node:assert/strict'
import test from 'node:test'
import {
  LIVE_MODE_THRESHOLD_MS,
  advanceTimeline,
  clampTimelineTime,
  findNearestSnapshot,
  findSurroundingSnapshots,
  getSnapshotRange,
  getTimelineBounds,
  isLiveTimestamp,
} from '../src/utils/timeline.js'

test('clampTimelineTime keeps timestamps inside the playback window', () => {
  const nowMs = 1_800_000_000_000
  const bounds = getTimelineBounds(nowMs)

  assert.equal(clampTimelineTime(nowMs + 5_000, nowMs), bounds.maxTime)
  assert.equal(clampTimelineTime(bounds.minTime - 5_000, nowMs), bounds.minTime)
})

test('isLiveTimestamp tracks proximity to the live edge', () => {
  const nowMs = 1_800_000_000_000

  assert.equal(isLiveTimestamp(nowMs - 2_000, nowMs), true)
  assert.equal(
    isLiveTimestamp(nowMs - LIVE_MODE_THRESHOLD_MS - 1, nowMs),
    false,
  )
})

test('advanceTimeline moves forward without exceeding the live edge', () => {
  const nowMs = 1_800_000_000_000
  const result = advanceTimeline(nowMs - 3_000, {
    nowMs,
    speed: 4,
    deltaMs: 1_000,
  })

  assert.equal(result.currentTime, nowMs)
  assert.equal(result.liveMode, true)
})

test('snapshot helpers find the nearest and surrounding session captures', () => {
  const snapshots = [
    { timestamp: 1_000, aircraftCatalog: [] },
    { timestamp: 5_000, aircraftCatalog: [] },
    { timestamp: 9_000, aircraftCatalog: [] },
  ]

  assert.deepEqual(getSnapshotRange(snapshots), {
    minTime: 1_000,
    maxTime: 9_000,
  })
  assert.equal(findNearestSnapshot(snapshots, 7_000).timestamp, 5_000)
  assert.deepEqual(findSurroundingSnapshots(snapshots, 6_000), {
    before: snapshots[1],
    after: snapshots[2],
  })
})
