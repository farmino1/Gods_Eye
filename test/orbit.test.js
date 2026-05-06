import assert from 'node:assert/strict'
import test from 'node:test'
import { getOrbitTrail } from '../src/utils/orbit.js'

const SAMPLE_TLE = {
  name: 'ISS (ZARYA)',
  line1: '1 25544U 98067A   24080.50000000  .00016717  00000+0  30000-3 0  9990',
  line2: '2 25544  51.6410 120.0000 0004820 120.0000 240.0000 15.50000000000000',
}

test('getOrbitTrail returns a closed orbit ring in the current Earth frame', () => {
  const trail = getOrbitTrail(
    SAMPLE_TLE,
    new Date('2024-03-20T12:00:00.000Z'),
    null,
    3,
  )

  assert.ok(trail.length > 10)

  const firstPoint = trail[0]
  const penultimatePoint = trail[trail.length - 2]
  const lastPoint = trail[trail.length - 1]
  const nearClosureDistanceMeters = Math.hypot(
    firstPoint.x - penultimatePoint.x,
    firstPoint.y - penultimatePoint.y,
    firstPoint.z - penultimatePoint.z,
  )
  const closureDistanceMeters = Math.hypot(
    firstPoint.x - lastPoint.x,
    firstPoint.y - lastPoint.y,
    firstPoint.z - lastPoint.z,
  )

  assert.ok(nearClosureDistanceMeters < 500_000)
  assert.ok(closureDistanceMeters < 1)
})
