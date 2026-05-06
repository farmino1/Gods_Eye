import * as Cesium from 'cesium'
import { getBboxSpans, normalizeBbox, wrapLongitude } from './geo.js'

const METERS_PER_LATITUDE_DEGREE = 111_320
const MIN_LONGITUDE_METERS_SCALE = 0.15
const MIN_LOCAL_HALF_DISTANCE_METERS = 250

export function getComputedViewRectangleDegrees(viewer) {
  const rectangle = viewer?.camera?.computeViewRectangle?.(
    viewer?.scene?.globe?.ellipsoid ?? Cesium.Ellipsoid.WGS84,
  )

  if (!rectangle) {
    return null
  }

  return normalizeBbox({
    west: Cesium.Math.toDegrees(rectangle.west),
    east: Cesium.Math.toDegrees(rectangle.east),
    south: Cesium.Math.toDegrees(rectangle.south),
    north: Cesium.Math.toDegrees(rectangle.north),
  })
}

export function buildDistanceLimitedViewRectangleDegrees({
  latitudeDegrees,
  longitudeDegrees,
  halfDistanceMeters,
} = {}) {
  const clampedLatitudeDegrees = Cesium.Math.clamp(
    Number(latitudeDegrees) || 0,
    -90,
    90,
  )
  const normalizedLongitudeDegrees = wrapLongitude(longitudeDegrees)
  const clampedHalfDistanceMeters = Math.max(
    MIN_LOCAL_HALF_DISTANCE_METERS,
    Number(halfDistanceMeters) || 0,
  )
  const latitudeHalfSpanDegrees =
    clampedHalfDistanceMeters / METERS_PER_LATITUDE_DEGREE
  const longitudeMetersPerDegree =
    METERS_PER_LATITUDE_DEGREE *
    Math.max(
      MIN_LONGITUDE_METERS_SCALE,
      Math.cos(Cesium.Math.toRadians(clampedLatitudeDegrees)),
    )
  const longitudeHalfSpanDegrees =
    clampedHalfDistanceMeters / longitudeMetersPerDegree

  return normalizeBbox({
    west: normalizedLongitudeDegrees - longitudeHalfSpanDegrees,
    east: normalizedLongitudeDegrees + longitudeHalfSpanDegrees,
    south: clampedLatitudeDegrees - latitudeHalfSpanDegrees,
    north: clampedLatitudeDegrees + latitudeHalfSpanDegrees,
  })
}

export function getHorizonAwareViewRectangleDegrees(
  viewer,
  {
    maximumCameraHeightMeters = 4_500,
    minimumPitchDegrees = -20,
    maximumPitchDegrees = 18,
    minLocalHalfDistanceMeters = 1_000,
    maxLocalHalfDistanceMeters = 5_000,
    localDistanceHeightMultiplier = 1.25,
  } = {},
) {
  const rawViewRectangle = getComputedViewRectangleDegrees(viewer)
  const cameraCartographic = viewer?.camera?.positionCartographic
  const cameraHeightMeters = Number(cameraCartographic?.height)
  const pitchDegrees = Cesium.Math.toDegrees(
    Number(viewer?.camera?.pitch) || 0,
  )

  if (
    !cameraCartographic ||
    !Number.isFinite(cameraHeightMeters) ||
    cameraHeightMeters > maximumCameraHeightMeters ||
    pitchDegrees < minimumPitchDegrees ||
    pitchDegrees > maximumPitchDegrees
  ) {
    return rawViewRectangle
  }

  const localHalfDistanceMeters = Cesium.Math.clamp(
    Math.max(0, cameraHeightMeters) * localDistanceHeightMultiplier,
    Math.max(
      MIN_LOCAL_HALF_DISTANCE_METERS,
      Number(minLocalHalfDistanceMeters) || MIN_LOCAL_HALF_DISTANCE_METERS,
    ),
    Math.max(
      Number(maxLocalHalfDistanceMeters) || minLocalHalfDistanceMeters,
      Number(minLocalHalfDistanceMeters) || MIN_LOCAL_HALF_DISTANCE_METERS,
    ),
  )
  const localViewRectangle = buildDistanceLimitedViewRectangleDegrees({
    latitudeDegrees: Cesium.Math.toDegrees(cameraCartographic.latitude),
    longitudeDegrees: Cesium.Math.toDegrees(cameraCartographic.longitude),
    halfDistanceMeters: localHalfDistanceMeters,
  })

  if (!rawViewRectangle) {
    return localViewRectangle
  }

  const rawSpans = getBboxSpans(rawViewRectangle)
  const localSpans = getBboxSpans(localViewRectangle)

  if (
    rawSpans.latitudeSpan <= localSpans.latitudeSpan &&
    rawSpans.longitudeSpan <= localSpans.longitudeSpan
  ) {
    return rawViewRectangle
  }

  return localViewRectangle
}
