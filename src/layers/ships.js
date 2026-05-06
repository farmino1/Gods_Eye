import * as Cesium from 'cesium'
import useTimeStore from '../store/timeStore.js'
import {
  fetchShips,
  interpolateShipCatalogSnapshots,
  SHIP_POLL_MS,
} from '../services/ships.js'
import { fetchShipTrack, buildTrackPositions } from '../services/shipInfo.js'
import { getBboxSpans, wrapLongitude } from '../utils/geo.js'
import { getShipFocusProfile } from '../utils/focusProfiles.js'
import { findSurroundingSnapshots, isLiveTimestamp } from '../utils/timeline.js'
import {
  computeHeadingAlignedQuaternion,
  computeSurfaceHeadingVector,
} from '../utils/worldOrientation.js'
import { getHorizonAwareViewRectangleDegrees } from '../utils/cameraViewport.js'

// Ships follow the same honesty model as aircraft: live data is interpolated in
// the moment, but rewind only uses session-captured snapshots.
const SHIP_ICON_PATH = '/icons/ship.svg'
const SHIP_ARROW_ICON_PATH = '/icons/ship-arrow.svg'
const CAMERA_REFRESH_MS = 220
const MAX_FETCH_LAT_SPAN_DEGREES = 48
const MAX_FETCH_LON_SPAN_DEGREES = 88
const MAX_EXTRAPOLATION_MS = SHIP_POLL_MS * 3
const VIEW_RECTANGLE_PADDING_RATIO = 0.15
const MAX_VISIBLE_LAT_SPAN_DEGREES = 24
const MAX_VISIBLE_LON_SPAN_DEGREES = 50
const SHIP_VOLUME_CAMERA_HEIGHT_METERS = 7_500
const SHIP_VOLUME_LATITUDE_SPAN_DEGREES = 0.05
const SHIP_VOLUME_LONGITUDE_SPAN_DEGREES = 0.07
const SHIP_VOLUME_THRESHOLD_EPSILON = 0.000001
const SHIP_HORIZON_MAX_CAMERA_HEIGHT_METERS = 5_000
const SHIP_HORIZON_MIN_PITCH_DEGREES = -22
const SHIP_HORIZON_MAX_PITCH_DEGREES = 16
const SHIP_HORIZON_MIN_HALF_DISTANCE_METERS = 3_000
const SHIP_HORIZON_MAX_HALF_DISTANCE_METERS = 12_000
const SHIP_HORIZON_HEIGHT_MULTIPLIER = 7
const HISTORY_SAMPLE_INTERVAL_MS = SHIP_POLL_MS
const MAX_HISTORY_SAMPLES = 720
const PORT_IDLE_SPEED_KNOTS = 1
const PORT_DEPARTURE_SPEED_KNOTS = 3
const PORT_IDLE_RESET_MS = 20 * 60 * 1000
const EARTH_RADIUS_METERS = Cesium.Ellipsoid.WGS84.maximumRadius
const VISIBLE_HEMISPHERE_THRESHOLD = -0.04
const SHIP_SCALE_BY_DISTANCE = new Cesium.NearFarScalar(
  500_000,
  0.9,
  12_000_000,
  0.38,
)
const SHIP_MODEL_COLOR_BLEND_AMOUNT = 0.18
const SHIP_TYPE_COLORS = {
  cargo: Cesium.Color.fromCssColorString('#38bdf8'),
  tanker: Cesium.Color.fromCssColorString('#fb7185'),
  passenger: Cesium.Color.fromCssColorString('#c084fc'),
  fishing: Cesium.Color.fromCssColorString('#34d399'),
  tug: Cesium.Color.fromCssColorString('#f59e0b'),
  pilot: Cesium.Color.fromCssColorString('#fde047'),
  military: Cesium.Color.RED,
  other: Cesium.Color.fromCssColorString('#94a3b8'),
}
const MAX_RENDERED_SHIPS = 500
// Adaptive update tuning
const MIN_ENTRY_UPDATE_MS = 40 // when few ships visible, update frequently (~25fps)
const MAX_ENTRY_UPDATE_MS = 800 // when many ships visible, update much less often
const MIN_FETCH_MS = Math.max(2000, Math.floor(SHIP_POLL_MS / 2))
const MAX_FETCH_MS = Math.max(60_000, SHIP_POLL_MS * 4)
const OFFLOAD_CHECK_MS = 2500 // how often to re-check offloaded entries for re-enable

function normalizeLongitudeDegrees(value) {
  return wrapLongitude(value)
}

function normalizeAngleDegrees(value) {
  return ((value % 360) + 360) % 360
}

export function shouldRenderShipAsVolume({
  viewRectangle,
  cameraHeightMeters,
} = {}) {
  if (!viewRectangle) {
    return false
  }

  const spans = getBboxSpans(viewRectangle)

  if (
    Number.isFinite(cameraHeightMeters) &&
    cameraHeightMeters > SHIP_VOLUME_CAMERA_HEIGHT_METERS
  ) {
    return false
  }

  return (
    spans.latitudeSpan <=
      SHIP_VOLUME_LATITUDE_SPAN_DEGREES + SHIP_VOLUME_THRESHOLD_EPSILON &&
    spans.longitudeSpan <=
      SHIP_VOLUME_LONGITUDE_SPAN_DEGREES + SHIP_VOLUME_THRESHOLD_EPSILON
  )
}

export function shouldRenderShipDetailModel() { return false; }

function interpolateAngleDegrees(start, end, progress) {
  const normalizedStart = normalizeAngleDegrees(start)
  const normalizedEnd = normalizeAngleDegrees(end)
  const delta = ((normalizedEnd - normalizedStart + 540) % 360) - 180

  return normalizeAngleDegrees(normalizedStart + delta * progress)
}

function interpolateLongitudeDegrees(start, end, progress) {
  const normalizedStart = normalizeLongitudeDegrees(start)
  const normalizedEnd = normalizeLongitudeDegrees(end)
  const delta = ((normalizedEnd - normalizedStart + 540) % 360) - 180

  return normalizeLongitudeDegrees(normalizedStart + delta * progress)
}

function toRenderCartesian(shipState, altitudeMeters = 0, result) {
  return Cesium.Cartesian3.fromDegrees(
    shipState.lon,
    shipState.lat,
    altitudeMeters,
    Cesium.Ellipsoid.WGS84,
    result,
  )
}

function cloneCartesianArray(positions) {
  return positions.map((position) => Cesium.Cartesian3.clone(position))
}

function getShipColor(shipState) {
  if (shipState?.isMilitary) {
    return SHIP_TYPE_COLORS.military
  }

  return SHIP_TYPE_COLORS[shipState?.type] || SHIP_TYPE_COLORS.other
}

function getShipHistoryColor(shipState) {
  return getShipColor(shipState).withAlpha(0.82)
}

function projectPosition(lat, lon, heading, distanceMeters) {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    return {
      lat,
      lon,
    }
  }

  const startLatitudeRadians = Cesium.Math.toRadians(lat)
  const startLongitudeRadians = Cesium.Math.toRadians(lon)
  const headingRadians = Cesium.Math.toRadians(
    normalizeAngleDegrees(heading),
  )
  const angularDistance = distanceMeters / EARTH_RADIUS_METERS
  const sinStartLatitude = Math.sin(startLatitudeRadians)
  const cosStartLatitude = Math.cos(startLatitudeRadians)
  const sinAngularDistance = Math.sin(angularDistance)
  const cosAngularDistance = Math.cos(angularDistance)
  const destinationLatitudeRadians = Math.asin(
    sinStartLatitude * cosAngularDistance +
      cosStartLatitude * sinAngularDistance * Math.cos(headingRadians),
  )
  const destinationLongitudeRadians =
    startLongitudeRadians +
    Math.atan2(
      Math.sin(headingRadians) * sinAngularDistance * cosStartLatitude,
      cosAngularDistance -
        sinStartLatitude * Math.sin(destinationLatitudeRadians),
    )

  return {
    lat: Cesium.Math.toDegrees(destinationLatitudeRadians),
    lon: normalizeLongitudeDegrees(
      Cesium.Math.toDegrees(destinationLongitudeRadians),
    ),
  }
}

function predictShipState(shipState, deltaMs) {
  if (!shipState) {
    return null
  }

  const secondsAhead = Math.max(0, deltaMs) / 1000
  const projectedPosition = projectPosition(
    shipState.lat,
    shipState.lon,
    shipState.heading,
    Math.max(0, shipState.speedMS) * secondsAhead,
  )

  return {
    ...shipState,
    ...projectedPosition,
  }
}

function interpolateShipState(startState, endState, progress) {
  return {
    ...endState,
    lat: Cesium.Math.lerp(startState.lat, endState.lat, progress),
    lon: interpolateLongitudeDegrees(startState.lon, endState.lon, progress),
    speedKnots: Cesium.Math.lerp(
      startState.speedKnots,
      endState.speedKnots,
      progress,
    ),
    speedMS: Cesium.Math.lerp(startState.speedMS, endState.speedMS, progress),
    heading: interpolateAngleDegrees(
      startState.heading,
      endState.heading,
      progress,
    ),
    course: interpolateAngleDegrees(
      startState.course,
      endState.course,
      progress,
    ),
    timestampMs: Cesium.Math.lerp(
      startState.timestampMs,
      endState.timestampMs,
      progress,
    ),
  }
}

function getRenderedState(entry, nowMs) {
  if (!entry.startState || !entry.endState || entry.endTimeMs <= entry.startTimeMs) {
    return entry.endState ?? entry.startState ?? null
  }

  const progress = Cesium.Math.clamp(
    (nowMs - entry.startTimeMs) / (entry.endTimeMs - entry.startTimeMs),
    0,
    1,
  )

  if (progress >= 1) {
    const extrapolationMs = Math.min(
      nowMs - entry.endTimeMs,
      MAX_EXTRAPOLATION_MS,
    )

    if (extrapolationMs > 0) {
      return predictShipState(entry.endState, extrapolationMs)
    }

    return entry.endState
  }

  return interpolateShipState(entry.startState, entry.endState, progress)
}

function getViewRectangleDegrees(viewer) {
  return getHorizonAwareViewRectangleDegrees(viewer, {
    maximumCameraHeightMeters: SHIP_HORIZON_MAX_CAMERA_HEIGHT_METERS,
    minimumPitchDegrees: SHIP_HORIZON_MIN_PITCH_DEGREES,
    maximumPitchDegrees: SHIP_HORIZON_MAX_PITCH_DEGREES,
    minLocalHalfDistanceMeters: SHIP_HORIZON_MIN_HALF_DISTANCE_METERS,
    maxLocalHalfDistanceMeters: SHIP_HORIZON_MAX_HALF_DISTANCE_METERS,
    localDistanceHeightMultiplier: SHIP_HORIZON_HEIGHT_MULTIPLIER,
  })
}

function getLongitudeSpan(viewRectangle) {
  if (!viewRectangle) {
    return 0
  }

  return viewRectangle.west <= viewRectangle.east
    ? viewRectangle.east - viewRectangle.west
    : 360 - viewRectangle.west + viewRectangle.east
}

function getVisibilityViewRectangleDegrees(viewer) {
  const viewRectangle = getViewRectangleDegrees(viewer)

  if (!viewRectangle) {
    return null
  }

  const latitudeSpan = Math.max(0, viewRectangle.north - viewRectangle.south)
  const longitudeSpan = getLongitudeSpan(viewRectangle)
  const latitudePadding = Math.min(
    12,
    latitudeSpan * VIEW_RECTANGLE_PADDING_RATIO,
  )
  const longitudePadding = Math.min(
    20,
    longitudeSpan * VIEW_RECTANGLE_PADDING_RATIO,
  )

  return {
    west: normalizeLongitudeDegrees(viewRectangle.west - longitudePadding),
    east: normalizeLongitudeDegrees(viewRectangle.east + longitudePadding),
    south: Math.max(-90, viewRectangle.south - latitudePadding),
    north: Math.min(90, viewRectangle.north + latitudePadding),
  }
}

function isLongitudeWithinBounds(longitude, west, east) {
  const normalizedLongitude = normalizeLongitudeDegrees(longitude)

  if (west <= east) {
    return normalizedLongitude >= west && normalizedLongitude <= east
  }

  return normalizedLongitude >= west || normalizedLongitude <= east
}

function isShipWithinViewRectangle(shipState, viewRectangle) {
  if (!viewRectangle) {
    return false
  }

  return (
    shipState.lat >= viewRectangle.south &&
    shipState.lat <= viewRectangle.north &&
    isLongitudeWithinBounds(
      shipState.lon,
      viewRectangle.west,
      viewRectangle.east,
    )
  )
}

function isShipLayerZoomedIn(viewRectangle) {
  if (!viewRectangle) {
    return false
  }

  const latitudeSpan = Math.max(0, viewRectangle.north - viewRectangle.south)
  const longitudeSpan = getLongitudeSpan(viewRectangle)

  return (
    latitudeSpan <= MAX_VISIBLE_LAT_SPAN_DEGREES &&
    longitudeSpan <= MAX_VISIBLE_LON_SPAN_DEGREES
  )
}

function buildFetchBbox(viewer) {
  const viewRectangle = getViewRectangleDegrees(viewer)

  if (!viewRectangle) {
    return {
      west: -44,
      east: 44,
      south: -24,
      north: 24,
    }
  }

  const latitudeSpan = Math.min(
    MAX_FETCH_LAT_SPAN_DEGREES,
    Math.max(6, viewRectangle.north - viewRectangle.south),
  )
  const rawLongitudeSpan =
    viewRectangle.west <= viewRectangle.east
      ? viewRectangle.east - viewRectangle.west
      : 360 - viewRectangle.west + viewRectangle.east
  const longitudeSpan = Math.min(
    MAX_FETCH_LON_SPAN_DEGREES,
    Math.max(10, rawLongitudeSpan),
  )
  const centerLatitude = (viewRectangle.north + viewRectangle.south) / 2
  const centerLongitude = normalizeLongitudeDegrees(
    viewRectangle.west + rawLongitudeSpan / 2,
  )
  const west = normalizeLongitudeDegrees(centerLongitude - longitudeSpan / 2)
  const east = normalizeLongitudeDegrees(centerLongitude + longitudeSpan / 2)

  if (west > east) {
    // Crossing the dateline is rare for the intended maritime views. For this
    // first pass we widen the request instead of trying to maintain a wrapped
    // two-box ship query model through the full stack.
    return {
      west: -180,
      east: 180,
      south: Math.max(-90, centerLatitude - latitudeSpan / 2),
      north: Math.min(90, centerLatitude + latitudeSpan / 2),
    }
  }

  return {
    west,
    east,
    south: Math.max(-90, centerLatitude - latitudeSpan / 2),
    north: Math.min(90, centerLatitude + latitudeSpan / 2),
  }
}

function isNearSideShip(cameraPosition, shipState) {
  const normalizedCameraPosition = Cesium.Cartesian3.normalize(
    cameraPosition,
    new Cesium.Cartesian3(),
  )
  const worldPosition = toRenderCartesian(
    shipState,
    0,
    new Cesium.Cartesian3(),
  )
  const normalizedWorldPosition = Cesium.Cartesian3.normalize(
    worldPosition,
    new Cesium.Cartesian3(),
  )

  return (
    Cesium.Cartesian3.dot(
      normalizedCameraPosition,
      normalizedWorldPosition,
    ) > VISIBLE_HEMISPHERE_THRESHOLD
  )
}

function buildSelection(entry) {
  const focusProfile = entry.focusProfile ?? getShipFocusProfile(entry.ship)

  return {
    type: 'ship',
    id: entry.ship.id,
    mmsi: entry.ship.mmsi,
    imo: entry.ship.imo,
    name: entry.ship.name,
    callsign: entry.ship.callsign,
    destination: entry.ship.destination,
    shipType: entry.ship.type,
    isMilitary: entry.ship.isMilitary,
    headingDegrees: normalizeAngleDegrees(entry.renderedState.heading),
    speedKnots: entry.renderedState.speedKnots,
    lastUpdateTimeMs: entry.renderedState.timestampMs,
    dimensionsMeters: focusProfile.targetDimensions,
    moreInfoUrl: entry.ship.moreInfoUrl,
  }
}

function getEntityMetadata(entity) {
  if (!entity?.properties) {
    return null
  }

  const now = Cesium.JulianDate.now()
  const layerType = entity.properties.layerType?.getValue(now)
  const shipId = entity.properties.shipId?.getValue(now)

  if (!layerType || !shipId) {
    return null
  }

  return {
    layerType,
    shipId,
  }
}

function updateEntryVisualState(entry, isSelected) {
  const color = getShipColor(entry.ship)
  const selectedColor = entry.ship.isMilitary
    ? Cesium.Color.fromCssColorString('#fca5a5')
    : Cesium.Color.WHITE

  entry.entity.billboard.color = isSelected
    ? selectedColor
    : color
  entry.entity.billboard.scale = isSelected ? 1.22 : 1

  if (entry.volumeEntity?.model) {
    entry.volumeEntity.model.color = color
    entry.volumeEntity.model.colorBlendMode = Cesium.ColorBlendMode.MIX
    entry.volumeEntity.model.colorBlendAmount =
      SHIP_MODEL_COLOR_BLEND_AMOUNT
    entry.volumeEntity.model.silhouetteColor = selectedColor
    entry.volumeEntity.model.silhouetteSize = isSelected ? 2.5 : 0
  }
}

function syncShipOrientationState(entry, shipState) {
  if (!entry || !shipState) {
    return
  }

  entry.renderRotationRadians = 0
  entry.alignedAxis = computeSurfaceHeadingVector(
    shipState,
    entry.alignedAxis ?? new Cesium.Cartesian3(),
  )
  entry.orientation = computeHeadingAlignedQuaternion(
    shipState,
    entry.orientation ?? new Cesium.Quaternion(),
  )
}

function isShipEntryVisible(entry) {
  return Boolean(entry?.entity?.show || entry?.volumeEntity?.show)
}

function shouldShowShipEntry(
  entry,
  cameraPosition,
  viewRectangle,
  selectedShipId,
) {
  if (!entry?.renderedState) {
    return false
  }

  if (entry.ship.id === selectedShipId || entry.ship.isMilitary) {
    return true
  }

  const isNearSide = isNearSideShip(cameraPosition, entry.renderedState)

  if (!isNearSide) {
    return false
  }

  if (!isShipLayerZoomedIn(viewRectangle)) {
    return false
  }

  return isShipWithinViewRectangle(entry.renderedState, viewRectangle)
}

export function createShipLayer({
  viewer,
  initialTimeMs = Date.now(),
  onSelectionChange,
} = {}) {
  const dataSource = new Cesium.CustomDataSource('ships')
  const shipEntries = new Map()
  const selectedOverlayState = {
    historyPositions: [],
  }

  let attached = false
  let destroyed = false
  let visible = false
  let selectedShipId = null
  let currentTimeMs = Number.isFinite(Number(initialTimeMs))
    ? Number(initialTimeMs)
    : Date.now()
  let latestShipCatalog = []
  let lastFetchedBbox = null
  let fetchTimeoutId = null
  let animationFrameId = null
  let removeCameraChangedListener = null
  let cameraRefreshTimeoutId = null
  let loadPromise = null
  let selectedHistoryEntity = null
  let lastGlobalPositionRefreshMs = 0

  const isLiveTimeline = () =>
    useTimeStore.getState().liveMode || isLiveTimestamp(currentTimeMs)

  const requestRender = () => {
    // Batch multiple requests into a single RAF-driven render call so
    // callers can safely call `requestRender()` frequently without
    // spamming Cesium's render loop.
    try {
      if (requestRender._pending || viewer.isDestroyed()) {
        return
      }

      requestRender._pending = true

      window.requestAnimationFrame(() => {
        requestRender._pending = false

        try {
          if (!viewer.isDestroyed()) {
            viewer.scene.requestRender()
          }
        } catch {
          // No-op during teardown.
        }
      })
    } catch {
      // No-op during teardown.
    }
  }

  const emitSelection = (entry) => {
    onSelectionChange?.(entry ? buildSelection(entry) : null)
  }

  const hideSelectedOverlay = () => {
    selectedOverlayState.historyPositions = []

    if (selectedHistoryEntity) {
      selectedHistoryEntity.show = false
      selectedHistoryEntity.properties = {
        layerType: 'ship-helper',
      }
    }
  }

  const ensureSelectedOverlayEntity = () => {
    if (selectedHistoryEntity) {
      return
    }

    selectedHistoryEntity = dataSource.entities.add({
      id: 'ship-selected-history',
      show: false,
      polyline: {
        positions: new Cesium.CallbackProperty(
          () => selectedOverlayState.historyPositions,
          false,
        ),
        width: 2,
        material: getShipHistoryColor({
          type: 'other',
        }),
        arcType: Cesium.ArcType.NONE,
      },
      properties: {
        layerType: 'ship-helper',
      },
    })
  }

  const buildHistoryOverlayPositions = (entry) => {
    if (!entry.historyPositions.length) {
      return []
    }

    const latestHistoryPosition =
      entry.historyPositions[entry.historyPositions.length - 1]
    const currentPosition = Cesium.Cartesian3.clone(entry.renderCartesian)

    if (
      Cesium.Cartesian3.distanceSquared(
        latestHistoryPosition,
        currentPosition,
      ) <= 1
    ) {
      return cloneCartesianArray(entry.historyPositions)
    }

    return [...cloneCartesianArray(entry.historyPositions), currentPosition]
  }

  const syncSelectedOverlay = (entry) => {
    if (!selectedHistoryEntity || !entry || !isShipEntryVisible(entry)) {
      hideSelectedOverlay()
      return
    }

    if (!isLiveTimeline()) {
      hideSelectedOverlay()
      return
    }

    const historyPositions = buildHistoryOverlayPositions(entry)
    selectedOverlayState.historyPositions = historyPositions
    selectedHistoryEntity.polyline.material = getShipHistoryColor(entry.ship)
    selectedHistoryEntity.show = historyPositions.length > 1
    selectedHistoryEntity.properties = {
      layerType: 'ship',
      mmsi: entry.ship.mmsi,
      name: entry.ship.name,
    }
  }

  const resetShipHistory = (entry) => {
    entry.historyPositions = []
    entry.lastHistoryTimestampMs = null
  }

  const pushHistorySample = (
    entry,
    shipState,
    timestampMs,
    { reset = false } = {},
  ) => {
    if (reset) {
      resetShipHistory(entry)
    }

    if (!shipState) {
      return
    }

    if (
      entry.lastHistoryTimestampMs !== null &&
      timestampMs - entry.lastHistoryTimestampMs < HISTORY_SAMPLE_INTERVAL_MS
    ) {
      return
    }

    const position = toRenderCartesian(
      shipState,
      entry.renderAltitudeMeters,
      new Cesium.Cartesian3(),
    )

    entry.historyPositions.push(Cesium.Cartesian3.clone(position))

    if (entry.historyPositions.length > MAX_HISTORY_SAMPLES) {
      entry.historyPositions.shift()
    }

    entry.lastHistoryTimestampMs = timestampMs
    // Removed verbose debug logging to reduce console I/O overhead
  }

  const updateShipHistory = (
    entry,
    shipState,
    timestampMs,
    { reset = false } = {},
  ) => {
    if (!shipState || !Number.isFinite(timestampMs)) {
      return
    }

    if (reset) {
      resetShipHistory(entry)
    }

    const speedKnots = Number.isFinite(shipState.speedKnots)
      ? shipState.speedKnots
      : 0
    const isIdle = speedKnots <= PORT_IDLE_SPEED_KNOTS
    const longStationary =
      entry.stationaryStartTimeMs !== null &&
      timestampMs - entry.stationaryStartTimeMs >= PORT_IDLE_RESET_MS
    const destinationChanged =
      Boolean(entry.lastDestination) &&
      Boolean(shipState.destination) &&
      shipState.destination !== entry.lastDestination

    if (isIdle) {
      if (entry.stationaryStartTimeMs === null) {
        entry.stationaryStartTimeMs = timestampMs
      }

      if (destinationChanged || longStationary) {
        entry.awaitingDeparture = true
        resetShipHistory(entry)
      }
    } else {
      const shouldResetForDeparture =
        entry.awaitingDeparture ||
        (
          longStationary &&
          speedKnots >= PORT_DEPARTURE_SPEED_KNOTS
        )

      if (shouldResetForDeparture) {
        resetShipHistory(entry)
      }

      entry.awaitingDeparture = false
      entry.stationaryStartTimeMs = null
    }

    entry.lastDestination = shipState.destination || entry.lastDestination || ''

    if (entry.awaitingDeparture) {
      return
    }

    pushHistorySample(entry, shipState, timestampMs)
  }

  const stopAnimationLoop = () => {
    if (!animationFrameId) {
      return
    }

    window.cancelAnimationFrame(animationFrameId)
    animationFrameId = null
  }

  const ensureAnimationLoop = () => {
    if (
      animationFrameId ||
      !visible ||
      destroyed ||
      !isLiveTimeline() ||
      shipEntries.size === 0
    ) {
      return
    }

    animationFrameId = window.requestAnimationFrame(animate)
  }

  // Compute adaptive intervals based on number of visible ships.
  const computeEntryUpdateInterval = (visibleCount) => {
    const ratio = Math.min(1, Math.max(0, visibleCount / MAX_RENDERED_SHIPS))
    return Math.round(
      MIN_ENTRY_UPDATE_MS + (MAX_ENTRY_UPDATE_MS - MIN_ENTRY_UPDATE_MS) * ratio,
    )
  }

  const computeFetchInterval = (visibleCount) => {
    const ratio = Math.min(1, Math.max(0, visibleCount / MAX_RENDERED_SHIPS))
    return Math.round(
      MIN_FETCH_MS + (MAX_FETCH_MS - MIN_FETCH_MS) * ratio,
    )
  }

  const countVisibleEntries = (cameraPosition = viewer.camera.positionWC) => {
    const viewRect = getVisibilityViewRectangleDegrees(viewer)
    let count = 0

    shipEntries.forEach((entry) => {
      const state = entry.renderedState || entry.endState
      if (!state) return

      try {
        if (
          isNearSideShip(cameraPosition, state) &&
          isShipWithinViewRectangle(state, viewRect)
        ) {
          count += 1
        }
      } catch (e) {
        // defensive: skip problematic entries
      }
    })

    return count
  }

  const scheduleNextFetch = (delayMs) => {
    if (fetchTimeoutId) {
      window.clearTimeout(fetchTimeoutId)
      fetchTimeoutId = null
    }

    if (!visible || destroyed || !isLiveTimeline()) {
      return
    }

    const visibleCount = countVisibleEntries()
    const nextInterval = Number.isFinite(delayMs)
      ? delayMs
      : computeFetchInterval(visibleCount)

    fetchTimeoutId = window.setTimeout(async () => {
      fetchTimeoutId = null

      if (!visible || destroyed || !isLiveTimeline()) {
        return
      }

      try {
        await refreshShipData({ force: true })
      } catch (error) {
        console.error('Unable to refresh live ship data.', error)
      } finally {
        // schedule subsequent fetch adaptively
        scheduleNextFetch()
      }
    }, nextInterval)
  }

  const startPolling = () => {
    if (fetchTimeoutId || !visible || destroyed || !isLiveTimeline()) {
      return
    }

    // run an immediate fetch then schedule the next one adaptively
    refreshShipData({ force: true })
      .catch((error) => {
        console.error('Unable to refresh live ship data.', error)
      })
      .finally(() => scheduleNextFetch())
  }

  const stopPolling = () => {
    if (fetchTimeoutId) {
      window.clearTimeout(fetchTimeoutId)
      fetchTimeoutId = null
    }
  }

  const cancelLoops = () => {
    stopPolling()
    stopAnimationLoop()
  }

  const clearCameraRefreshTimeout = () => {
    if (cameraRefreshTimeoutId !== null) {
      window.clearTimeout(cameraRefreshTimeoutId)
      cameraRefreshTimeoutId = null
    }
  }

  const attachDataSource = async () => {
    if (attached || destroyed) {
      return
    }

    attached = true
    await viewer.dataSources.add(dataSource)
  }

  const detachDataSource = () => {
    if (!attached) {
      return
    }

    attached = false
    viewer.dataSources.remove(dataSource, false)
  }

  const getPlaybackCatalog = () => {
    const shipSnapshots = useTimeStore
      .getState()
      .getSnapshots('ships')
    const { before, after } = findSurroundingSnapshots(
      shipSnapshots,
      currentTimeMs,
    )

    return interpolateShipCatalogSnapshots(before, after, currentTimeMs)
  }

  const clearSelection = () => {
    if (selectedShipId) {
      const selectedEntry = shipEntries.get(selectedShipId)

      if (selectedEntry) {
        updateEntryVisualState(selectedEntry, false)
        selectedShipId = null
        syncEntryVisibility(selectedEntry)
      } else {
        selectedShipId = null
      }
    } else {
      selectedShipId = null
    }

    hideSelectedOverlay()
    emitSelection(null)
    requestRender()
  }

  const removeEntry = (shipId) => {
    const entry = shipEntries.get(shipId)

    if (!entry) {
      return
    }

    if (selectedShipId === shipId) {
      clearSelection()
    }

    dataSource.entities.remove(entry.entity)
    if (entry.volumeEntity) {
      dataSource.entities.remove(entry.volumeEntity)
    }
    if (entry.historyPolyline) {
      dataSource.entities.remove(entry.historyPolyline)
    }
    shipEntries.delete(shipId)
  }

  const syncEntryVisibility = (
    entry,
    cameraPosition = viewer.camera.positionWC,
    viewRectangle = getVisibilityViewRectangleDegrees(viewer),
    volumeViewRectangle = getViewRectangleDegrees(viewer),
  ) => {
    const shouldShow = shouldShowShipEntry(
      entry,
      cameraPosition,
      viewRectangle,
      selectedShipId,
    )
    const showVolume = shouldShow &&
      shouldRenderShipDetailModel({
        viewRectangle: volumeViewRectangle,
        cameraHeightMeters: Number(viewer?.camera?.positionCartographic?.height),
        isSelected: entry.ship.id === selectedShipId,
      })

    entry.entity.show = shouldShow && !showVolume
    if (entry.volumeEntity) {
      entry.volumeEntity.show = shouldShow && showVolume
    }
    // Show history polyline when ship is visible and has history positions
    if (entry.historyPolyline) {
      entry.historyPolyline.show = shouldShow && entry.historyPositions.length > 1
    }
  }

  const loadShipTrack = async (entry) => {
    if (!entry || entry.trackLoading) {
      return
    }

    const mmsi = entry.ship.mmsi
    if (!mmsi) {
      return
    }

    entry.trackLoading = true

    try {
      const trackData = await fetchShipTrack(mmsi, 7, 3000)

      if (trackData?.track?.positions?.length > 1) {
        const positions = buildTrackPositions(trackData.track.positions)

        if (positions.length > 1) {
          entry.trackPositions = positions
          entry.trackEntity = dataSource.entities.add({
            id: `shipinfo-track-${entry.ship.id}`,
            show: true,
            polyline: {
              positions: new Cesium.CallbackProperty(
                () => entry.trackPositions || [],
                false,
              ),
              width: 2,
              material: getShipHistoryColor(entry.ship),
              arcType: Cesium.ArcType.NONE,
              clampToGround: false,
            },
            properties: {
              layerType: 'shipinfo-track',
              shipId: entry.ship.id,
            },
          })
          // Loaded track positions (debug log removed to avoid noisy console output)
        }
      }
    } catch (error) {
      console.error(`[shipinfo-track] Failed to load track for ${entry.ship.id}:`, error)
    } finally {
      entry.trackLoading = false
    }
  }

  const createEntry = (shipState, timestampMs, { playbackMode = false } = {}) => {
    const focusProfile = getShipFocusProfile(shipState)
    const nextEntry = {
      ship: shipState,
      entity: null,
      volumeEntity: null,
      startState: shipState,
      endState: shipState,
      startTimeMs: timestampMs,
      endTimeMs: timestampMs,
      renderedState: shipState,
      renderCartesian: toRenderCartesian(
        shipState,
        focusProfile.waterlineOffsetMeters,
        new Cesium.Cartesian3(),
      ),
      renderRotationRadians: 0,
      alignedAxis: computeSurfaceHeadingVector(
        shipState,
        new Cesium.Cartesian3(),
      ),
      orientation: computeHeadingAlignedQuaternion(
        shipState,
        new Cesium.Quaternion(),
      ),
      focusProfile,
      renderAltitudeMeters: focusProfile.waterlineOffsetMeters,
      historyPositions: [],
      lastHistoryTimestampMs: null,
      awaitingDeparture:
        Number.isFinite(shipState.speedKnots) &&
        shipState.speedKnots <= PORT_IDLE_SPEED_KNOTS,
      stationaryStartTimeMs:
        Number.isFinite(shipState.speedKnots) &&
        shipState.speedKnots <= PORT_IDLE_SPEED_KNOTS
          ? timestampMs
          : null,
      lastDestination: shipState.destination,
      trackPositions: [],
      trackEntity: null,
      trackLoading: false,
    }

    nextEntry.entity = dataSource.entities.add({
      id: `ship-${shipState.id}`,
      show: true,
      position: new Cesium.CallbackProperty(
        (_time, result) =>
          Cesium.Cartesian3.clone(nextEntry.renderCartesian, result),
        false,
      ),
      billboard: {
        image: new Cesium.CallbackProperty(() => {
          // Use arrow icon when zoomed out, ship icon when zoomed in
          const height = viewer?.camera?.positionCartographic?.height
          return height && height > 2_000_000
            ? SHIP_ARROW_ICON_PATH
            : SHIP_ICON_PATH
        }, false),
        width: new Cesium.CallbackProperty(() => {
          const height = viewer?.camera?.positionCartographic?.height
          return height && height > 2_000_000 ? 16 : 22
        }, false),
        height: new Cesium.CallbackProperty(() => {
          const height = viewer?.camera?.positionCartographic?.height
          return height && height > 2_000_000 ? 16 : 22
        }, false),
        color: getShipColor(shipState),
        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        alignedAxis: new Cesium.CallbackProperty(
          (_time, result) => Cesium.Cartesian3.clone(nextEntry.alignedAxis, result),
          false,
        ),
        rotation: new Cesium.CallbackProperty(
          () => nextEntry.renderRotationRadians,
          false,
        ),
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        scaleByDistance: SHIP_SCALE_BY_DISTANCE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      properties: {
        layerType: 'ship',
        shipId: shipState.id,
        mmsi: shipState.mmsi,
        name: shipState.name,
      },
    })

    // Track history polyline for all ships
    nextEntry.historyPolyline = dataSource.entities.add({
      id: `ship-history-${shipState.id}`,
      show: true,
      polyline: {
        positions: new Cesium.CallbackProperty(
          () => buildHistoryOverlayPositions(nextEntry),
          false,
        ),
        width: 2,
        material: getShipHistoryColor(shipState),
        arcType: Cesium.ArcType.NONE,
        clampToGround: false,
      },
      properties: {
        layerType: 'ship-history',
        shipId: shipState.id,
      },
    })

    nextEntry.volumeEntity = dataSource.entities.add({
      id: `ship-volume-${shipState.id}`,
      show: false,
      position: new Cesium.CallbackProperty(
        (_time, result) =>
          Cesium.Cartesian3.clone(nextEntry.renderCartesian, result),
        false,
      ),
      orientation: new Cesium.CallbackProperty(
        (_time, result) => Cesium.Quaternion.clone(nextEntry.orientation, result),
        false,
      ),
      model: {
        uri: nextEntry.focusProfile.modelPath,
        scale: nextEntry.focusProfile.modelScale,
        minimumPixelSize: 0,
        heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        color: getShipColor(shipState),
        colorBlendMode: Cesium.ColorBlendMode.MIX,
        colorBlendAmount: SHIP_MODEL_COLOR_BLEND_AMOUNT,
        silhouetteSize: 0,
        runAnimations: false,
      },
      properties: {
        layerType: 'ship',
        shipId: shipState.id,
        mmsi: shipState.mmsi,
        name: shipState.name,
      },
    })

    // Internal flags for adaptive updates/offloading
    nextEntry._lastRenderedUpdateMs = timestampMs || Date.now()
    nextEntry._offloaded = false
    nextEntry._lastOffloadCheckMs = 0

    if (!playbackMode) {
      updateShipHistory(nextEntry, shipState, timestampMs, {
        reset: true,
      })
    }

    shipEntries.set(shipState.id, nextEntry)
    return nextEntry
  }

  const reconcileCatalog = (
    shipCatalog,
    {
      timestampMs = currentTimeMs,
      playbackMode = !isLiveTimeline(),
    } = {},
  ) => {
    const seenShipIds = new Set()
    const cameraPosition = viewer.camera.positionWC
    const viewRectangle = getVisibilityViewRectangleDegrees(viewer)
    const volumeViewRectangle = getViewRectangleDegrees(viewer)

    ensureSelectedOverlayEntity()

    shipCatalog.forEach((shipState) => {
      seenShipIds.add(shipState.id)
      const existingEntry = shipEntries.get(shipState.id)

      if (!existingEntry) {
        // Cull creation of off-screen entities when catalog is large to
        // avoid creating thousands of Cesium entities at once. Always
        // ensure the currently selected ship is created so selection works.
        if (
          shipCatalog.length > MAX_RENDERED_SHIPS &&
          viewRectangle &&
          shipState.id !== selectedShipId
        ) {
          const paddingLon = Math.max(10, (viewRectangle.east - viewRectangle.west) * 0.5)
          const paddingLat = Math.max(5, (viewRectangle.north - viewRectangle.south) * 0.5)
          const lat = shipState.lat
          const lon = wrapLongitude(shipState.lon)
          const westPad = wrapLongitude(viewRectangle.west - paddingLon)
          const eastPad = wrapLongitude(viewRectangle.east + paddingLon)
          let lonInRange = false

          if (westPad <= eastPad) {
            lonInRange = lon >= westPad && lon <= eastPad
          } else {
            lonInRange = lon >= westPad || lon <= eastPad
          }

          if (!(lat >= viewRectangle.south - paddingLat && lat <= viewRectangle.north + paddingLat && lonInRange)) {
            // Skip creating an entity for this off-screen ship
            return
          }
        }
        const nextEntry = createEntry(shipState, timestampMs, {
          playbackMode,
        })
        syncEntryVisibility(
          nextEntry,
          cameraPosition,
          viewRectangle,
          volumeViewRectangle,
        )
        updateEntryVisualState(nextEntry, shipState.id === selectedShipId)
        return
      }

      existingEntry.ship = shipState
      existingEntry.focusProfile = getShipFocusProfile(shipState)
      existingEntry.renderAltitudeMeters =
        existingEntry.focusProfile.waterlineOffsetMeters
      existingEntry.startState = existingEntry.endState ?? shipState
      existingEntry.endState = shipState
      existingEntry.startTimeMs = existingEntry.endTimeMs ?? timestampMs
      existingEntry.endTimeMs = timestampMs
      // Live updates are blended from the previous rendered state toward the
      // new payload so vessels do not jump sharply between polls.
      existingEntry.renderedState = getRenderedState(existingEntry, currentTimeMs) || shipState
      toRenderCartesian(
        existingEntry.renderedState,
        existingEntry.renderAltitudeMeters,
        existingEntry.renderCartesian,
      )
      syncShipOrientationState(
        existingEntry,
        existingEntry.renderedState,
      )

      if (!playbackMode) {
        updateShipHistory(existingEntry, shipState, timestampMs)
      }

      if (existingEntry.volumeEntity?.model) {
        existingEntry.volumeEntity.model.uri =
          existingEntry.focusProfile.modelPath
        existingEntry.volumeEntity.model.scale =
          existingEntry.focusProfile.modelScale
      }

      syncEntryVisibility(
        existingEntry,
        cameraPosition,
        viewRectangle,
        volumeViewRectangle,
      )
      updateEntryVisualState(existingEntry, shipState.id === selectedShipId)
    })

    ;[...shipEntries.entries()].forEach(([shipId, entry]) => {
      if (seenShipIds.has(shipId)) {
        return
      }

      const shouldRetainEntry =
        !playbackMode &&
        (shipId === selectedShipId || entry.ship.isMilitary)

      if (!shouldRetainEntry) {
        removeEntry(shipId)
        return
      }

      syncEntryVisibility(
        entry,
        cameraPosition,
        viewRectangle,
        volumeViewRectangle,
      )
      updateEntryVisualState(entry, shipId === selectedShipId)
    })

    if (selectedShipId) {
      const selectedEntry = shipEntries.get(selectedShipId)

      if (selectedEntry) {
        emitSelection(selectedEntry)
        syncSelectedOverlay(selectedEntry)
      } else {
        hideSelectedOverlay()
      }
    } else {
      hideSelectedOverlay()
    }

    // Offload far/offscreen entries when we have a large catalog to avoid
    // spending cycles updating/hiding a huge number of entities each frame.
    if (shipEntries.size > MAX_RENDERED_SHIPS) {
      shipEntries.forEach((entry) => {
        if (!entry || !entry.ship) return

        // Never offload selected or military vessels.
        if (entry.ship.id === selectedShipId || entry.ship.isMilitary) {
          if (entry._offloaded) {
            entry._offloaded = false
            // re-evaluate visibility immediately for re-enabled entries
            syncEntryVisibility(entry)
          }
          return
        }

        const state = entry.renderedState || entry.endState
        if (!state) return

        // If vessel is clearly outside a padded view rectangle, mark it
        // as offloaded and hide its entities so Cesium skips render work.
        const viewRect = getVisibilityViewRectangleDegrees(viewer)
        const isCandidateVisible =
          isNearSideShip(viewer.camera.positionWC, state) &&
          isShipWithinViewRectangle(state, viewRect)

        if (!isCandidateVisible) {
          if (!entry._offloaded) {
            entry._offloaded = true
            entry._offloadSince = Date.now()
            if (entry.entity) entry.entity.show = false
            if (entry.volumeEntity) entry.volumeEntity.show = false
            if (entry.historyPolyline) entry.historyPolyline.show = false
          }
        } else if (entry._offloaded) {
          // Re-enable entry when it moves back into view
          entry._offloaded = false
          syncEntryVisibility(entry)
        }
      })
    } else {
      // Ensure any previously offloaded entries are re-enabled when load is small
      shipEntries.forEach((entry) => {
        if (entry && entry._offloaded) {
          entry._offloaded = false
          syncEntryVisibility(entry)
        }
      })
    }

    requestRender()
  }

  const refreshEntryPositions = (timestampMs = Date.now()) => {
    const now = Number.isFinite(Number(timestampMs)) ? Number(timestampMs) : Date.now()
    const cameraPosition = viewer.camera.positionWC
    const viewRectangle = getVisibilityViewRectangleDegrees(viewer)
    const volumeViewRectangle = getViewRectangleDegrees(viewer)

    // Decide if a full update pass is required based on adaptive interval
    const approximateVisible = countVisibleEntries(cameraPosition)
    const globalEntryInterval = computeEntryUpdateInterval(approximateVisible)

    if (now - lastGlobalPositionRefreshMs < globalEntryInterval) {
      // Only update the selected ship and overlay to keep UI responsive.
      if (selectedShipId) {
        const selectedEntry = shipEntries.get(selectedShipId)

        if (selectedEntry) {
          selectedEntry.renderedState =
            getRenderedState(selectedEntry, now) || selectedEntry.endState

          if (selectedEntry.renderedState) {
            toRenderCartesian(
              selectedEntry.renderedState,
              selectedEntry.renderAltitudeMeters,
              selectedEntry.renderCartesian,
            )
            syncShipOrientationState(selectedEntry, selectedEntry.renderedState)
            syncEntryVisibility(
              selectedEntry,
              cameraPosition,
              viewRectangle,
              volumeViewRectangle,
            )
            emitSelection(selectedEntry)
            syncSelectedOverlay(selectedEntry)
            requestRender()
          }
        }

        return
      }

      // Nothing to do this frame — avoid expensive per-entry math.
      return
    }

    // Run an adaptive full-pass update.
    lastGlobalPositionRefreshMs = now

    shipEntries.forEach((entry) => {
      if (!entry) return

      // If offloaded, only periodically check whether it should be re-enabled.
      if (entry._offloaded) {
        if (now - (entry._lastOffloadCheckMs || 0) >= OFFLOAD_CHECK_MS) {
          entry._lastOffloadCheckMs = now
          const state = entry.endState || entry.renderedState
          if (state) {
            try {
              const becameVisible =
                isNearSideShip(cameraPosition, state) &&
                isShipWithinViewRectangle(state, viewRectangle)

              if (becameVisible) {
                entry._offloaded = false
                // force an immediate visual sync for re-enabled entries
                entry._lastRenderedUpdateMs = 0
                syncEntryVisibility(entry)
              }
            } catch (e) {
              // defensive
            }
          }
        }

        return
      }

      // Determine per-entry minimum update cadence. Selected and military
      // vessels are updated more frequently to keep UI responsive.
      const isHighPriority =
        entry.ship.id === selectedShipId || entry.ship.isMilitary
      const perEntryInterval = isHighPriority ? MIN_ENTRY_UPDATE_MS : globalEntryInterval

      if (now - (entry._lastRenderedUpdateMs || 0) < perEntryInterval) {
        // Skip this entry for now — it's updated often enough.
        return
      }

      entry._lastRenderedUpdateMs = now

      entry.renderedState = getRenderedState(entry, now) || entry.endState

      if (!entry.renderedState) {
        return
      }

      toRenderCartesian(
        entry.renderedState,
        entry.renderAltitudeMeters,
        entry.renderCartesian,
      )
      syncShipOrientationState(entry, entry.renderedState)

      syncEntryVisibility(
        entry,
        cameraPosition,
        viewRectangle,
        volumeViewRectangle,
      )

      // Update history polyline visibility based on current state
      if (entry.historyPolyline) {
        const shouldShow = entry.entity?.show || entry.volumeEntity?.show
        entry.historyPolyline.show = shouldShow && entry.historyPositions.length > 1
      }

      if (entry.ship.id === selectedShipId) {
        emitSelection(entry)
      }
    })

    if (selectedShipId) {
      const selectedEntry = shipEntries.get(selectedShipId)

      if (selectedEntry) {
        syncSelectedOverlay(selectedEntry)
      } else {
        hideSelectedOverlay()
      }
    } else {
      hideSelectedOverlay()
    }

    requestRender()
  }

  async function refreshShipData({ force = false } = {}) {
    if (!visible || destroyed || !isLiveTimeline()) {
      return
    }

    const nextBbox = buildFetchBbox(viewer)
    const nextBboxKey = JSON.stringify(nextBbox)

    if (!force && nextBboxKey === lastFetchedBbox && latestShipCatalog.length > 0) {
      return
    }

    const payload = await fetchShips({
      bbox: nextBbox,
    })

    lastFetchedBbox = nextBboxKey
    latestShipCatalog = payload.ships
    reconcileCatalog(payload.ships, {
      timestampMs: payload.timeMs,
    })

    useTimeStore.getState().addSnapshot('ships', {
      timestamp: payload.timeMs,
      catalog: payload.ships,
      source: payload.source,
      coverage: payload.configured ? 'live' : 'unconfigured',
      bbox: nextBbox,
    })
  }

  function animate() {
    if (!visible || destroyed || !isLiveTimeline()) {
      animationFrameId = null
      return
    }

    // requestAnimationFrame timestamps are relative to page start, while ship
    // interpolation is based on epoch timestamps from the backend.
    refreshEntryPositions(Date.now())
    animationFrameId = window.requestAnimationFrame(animate)
  }

  const scheduleCameraRefresh = () => {
    clearCameraRefreshTimeout()
    cameraRefreshTimeoutId = window.setTimeout(() => {
      cameraRefreshTimeoutId = null

      if (!visible || destroyed) {
        return
      }

      refreshEntryPositions(isLiveTimeline() ? Date.now() : currentTimeMs)

      if (isLiveTimeline()) {
        refreshShipData().catch((error) => {
          console.error('Unable to refresh ship coverage for the new camera view.', error)
        })
      }
    }, CAMERA_REFRESH_MS)
  }

  const attachCameraListener = () => {
    if (removeCameraChangedListener || destroyed) {
      return
    }

    removeCameraChangedListener = viewer.camera.changed.addEventListener(
      scheduleCameraRefresh,
    )
  }

  const detachCameraListener = () => {
    if (!removeCameraChangedListener) {
      return
    }

    removeCameraChangedListener()
    removeCameraChangedListener = null
  }

  return {
    async show() {
      if (destroyed) {
        return
      }

      visible = true

      if (!loadPromise) {
        loadPromise = attachDataSource().finally(() => {
          loadPromise = null
        })
      }

      await loadPromise
      ensureSelectedOverlayEntity()
      attachCameraListener()

      if (isLiveTimeline()) {
        await refreshShipData({ force: true })
        ensureAnimationLoop()
        startPolling()

        return
      }

      reconcileCatalog(getPlaybackCatalog(), {
        timestampMs: currentTimeMs,
      })
    },

    hide() {
      visible = false
      cancelLoops()
      clearCameraRefreshTimeout()
      detachCameraListener()
      clearSelection()
      hideSelectedOverlay()
      detachDataSource()
    },

    setTime(nextTimeMs) {
      const parsedTimeMs = Number(nextTimeMs)

      if (!Number.isFinite(parsedTimeMs)) {
        return
      }

      const wasLiveTimeline = isLiveTimeline()
      currentTimeMs = parsedTimeMs
      const nextIsLiveTimeline = isLiveTimeline()

      if (!visible || destroyed) {
        return
      }

      if (nextIsLiveTimeline) {
        ensureAnimationLoop()
        startPolling()
        refreshEntryPositions(Date.now())

        if (!wasLiveTimeline) {
          refreshShipData({ force: true }).catch((error) => {
            console.error('Unable to refresh ships for live playback.', error)
          })
        }

        return
      }

      cancelLoops()
      reconcileCatalog(getPlaybackCatalog(), {
        timestampMs: parsedTimeMs,
        playbackMode: true,
      })
    },

    clearSelection,

    getFocusTarget() {
      if (!selectedShipId) {
        return null
      }

      const selectedEntry = shipEntries.get(selectedShipId)

      if (!selectedEntry?.volumeEntity) {
        return null
      }

      return {
        entity: selectedEntry.volumeEntity,
        focus: selectedEntry.focusProfile?.focus,
      }
    },

    handlePick(pickedObject) {
      const entity = pickedObject?.id
      const metadata = getEntityMetadata(entity)

      if (metadata?.layerType !== 'ship') {
        return false
      }

      const entry = shipEntries.get(metadata.shipId)

      if (!entry) {
        return false
      }

      const previousSelectedShipId = selectedShipId
      selectedShipId = entry.ship.id

      if (
        previousSelectedShipId &&
        previousSelectedShipId !== entry.ship.id
      ) {
        const previousEntry = shipEntries.get(previousSelectedShipId)

        if (previousEntry) {
          updateEntryVisualState(previousEntry, false)
          syncEntryVisibility(previousEntry)
        }
      }

      updateEntryVisualState(entry, true)
      syncEntryVisibility(entry)
      emitSelection(entry)
      syncSelectedOverlay(entry)
      // Load ship track from shipinfo.net when selected
      loadShipTrack(entry)
      requestRender()
      return true
    },

    destroy() {
      destroyed = true
      this.hide()
      dataSource.entities.removeAll()
      shipEntries.clear()
    },
  }
}
