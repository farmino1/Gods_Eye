import assert from 'node:assert/strict'
import test from 'node:test'
import * as Cesium from 'cesium'
import {
  buildDistanceLimitedViewRectangleDegrees,
  getHorizonAwareViewRectangleDegrees,
} from '../src/utils/cameraViewport.js'
import { getBboxSpans } from '../src/utils/geo.js'

function assertBboxApproximatelyEqual(actual, expected, epsilon = 0.000001) {
  assert.ok(Math.abs(actual.west - expected.west) <= epsilon)
  assert.ok(Math.abs(actual.south - expected.south) <= epsilon)
  assert.ok(Math.abs(actual.east - expected.east) <= epsilon)
  assert.ok(Math.abs(actual.north - expected.north) <= epsilon)
}

function createViewer({
  longitudeDegrees = -0.12,
  latitudeDegrees = 51.5,
  heightMeters = 800,
  pitchDegrees = -6,
  rectangleDegrees = null,
} = {}) {
  return {
    scene: {
      globe: {
        ellipsoid: Cesium.Ellipsoid.WGS84,
      },
    },
    camera: {
      pitch: Cesium.Math.toRadians(pitchDegrees),
      positionCartographic: {
        longitude: Cesium.Math.toRadians(longitudeDegrees),
        latitude: Cesium.Math.toRadians(latitudeDegrees),
        height: heightMeters,
      },
      computeViewRectangle() {
        return rectangleDegrees
          ? Cesium.Rectangle.fromDegrees(
              rectangleDegrees.west,
              rectangleDegrees.south,
              rectangleDegrees.east,
              rectangleDegrees.north,
            )
          : null
      },
    },
  }
}

test('buildDistanceLimitedViewRectangleDegrees creates a centered local bbox', () => {
  const bbox = buildDistanceLimitedViewRectangleDegrees({
    latitudeDegrees: 51.5,
    longitudeDegrees: -0.12,
    halfDistanceMeters: 1_000,
  })
  const spans = getBboxSpans(bbox)

  assert.ok(Math.abs((bbox.north + bbox.south) / 2 - 51.5) < 0.000001)
  assert.ok(Math.abs((bbox.west + bbox.east) / 2 + 0.12) < 0.000001)
  assert.ok(spans.latitudeSpan > 0.017)
  assert.ok(spans.latitudeSpan < 0.019)
  assert.ok(spans.longitudeSpan > 0.028)
  assert.ok(spans.longitudeSpan < 0.03)
})

test('getHorizonAwareViewRectangleDegrees keeps the raw view when the camera is looking down', () => {
  const viewer = createViewer({
    pitchDegrees: -42,
    rectangleDegrees: {
      west: -0.2,
      south: 51.45,
      east: 0.2,
      north: 51.58,
    },
  })

  assertBboxApproximatelyEqual(
    getHorizonAwareViewRectangleDegrees(viewer, {
      maximumCameraHeightMeters: 3_000,
      minLocalHalfDistanceMeters: 900,
      maxLocalHalfDistanceMeters: 2_000,
      localDistanceHeightMultiplier: 1.2,
    }),
    {
      west: -0.2,
      south: 51.45,
      east: 0.2,
      north: 51.58,
    },
  )
})

test('getHorizonAwareViewRectangleDegrees limits shallow low-altitude horizon views to a local area', () => {
  const viewer = createViewer({
    heightMeters: 700,
    pitchDegrees: -5,
    rectangleDegrees: {
      west: -8,
      south: 49,
      east: 8,
      north: 55,
    },
  })
  const bbox = getHorizonAwareViewRectangleDegrees(viewer, {
    maximumCameraHeightMeters: 3_000,
    minLocalHalfDistanceMeters: 900,
    maxLocalHalfDistanceMeters: 2_000,
    localDistanceHeightMultiplier: 1.25,
  })
  const spans = getBboxSpans(bbox)

  assert.ok(Math.abs((bbox.north + bbox.south) / 2 - 51.5) < 0.000001)
  assert.ok(Math.abs((bbox.west + bbox.east) / 2 + 0.12) < 0.000001)
  assert.ok(spans.latitudeSpan < 0.02)
  assert.ok(spans.longitudeSpan < 0.031)
})

test('getHorizonAwareViewRectangleDegrees preserves already-small shallow views', () => {
  const viewer = createViewer({
    heightMeters: 600,
    pitchDegrees: -3,
    rectangleDegrees: {
      west: -0.125,
      south: 51.494,
      east: -0.115,
      north: 51.506,
    },
  })

  assertBboxApproximatelyEqual(
    getHorizonAwareViewRectangleDegrees(viewer, {
      maximumCameraHeightMeters: 3_000,
      minLocalHalfDistanceMeters: 900,
      maxLocalHalfDistanceMeters: 2_000,
      localDistanceHeightMultiplier: 1.3,
    }),
    {
      west: -0.125,
      south: 51.494,
      east: -0.115,
      north: 51.506,
    },
  )
})

test('getHorizonAwareViewRectangleDegrees falls back to a local bbox when the horizon view has no computed rectangle', () => {
  const bbox = getHorizonAwareViewRectangleDegrees(
    createViewer({
      heightMeters: 500,
      pitchDegrees: 4,
      rectangleDegrees: null,
    }),
    {
      maximumCameraHeightMeters: 3_000,
      minLocalHalfDistanceMeters: 800,
      maxLocalHalfDistanceMeters: 1_800,
      localDistanceHeightMultiplier: 1.2,
    },
  )
  const spans = getBboxSpans(bbox)

  assert.ok(spans.latitudeSpan > 0.014)
  assert.ok(spans.latitudeSpan < 0.015)
  assert.ok(spans.longitudeSpan > 0.023)
  assert.ok(spans.longitudeSpan < 0.024)
})
