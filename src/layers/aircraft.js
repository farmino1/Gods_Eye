import * as Cesium from 'cesium'
import {
  DEFAULT_AIRCRAFT_LIMIT,
  fetchAircraft,
  interpolateAircraftCatalogSnapshots,
  sortAircraftForDisplay,
} from '../services/aircraft.js'
import useTimeStore from '../store/timeStore.js'
import {
  findSurroundingSnapshots,
  isLiveTimestamp,
} from '../utils/timeline.js'
import { getAircraftFocusProfile } from '../utils/focusProfiles.js'
import { getHorizonAwareViewRectangleDegrees } from '../utils/cameraViewport.js'
import {
  computeHeadingAlignedQuaternion,
  computeSurfaceHeadingVector,
} from '../utils/worldOrientation.js'

const AIRCRAFT_POLL_MS = 10_000
const AIRCRAFT_PREDICTION_MS = AIRCRAFT_POLL_MS
const MAX_EXTRAPOLATION_MS = 5_000
const CAMERA_REFRESH_MS = 180
const HISTORY_SAMPLE_INTERVAL_MS = AIRCRAFT_POLL_MS
const MAX_HISTORY_SAMPLES = 720
const VISIBLE_HEMISPHERE_THRESHOLD = 0
const VIEW_RECTANGLE_PADDING_RATIO = 0.15
const AIRCRAFT_HORIZON_MAX_CAMERA_HEIGHT_METERS = 6_000
const AIRCRAFT_HORIZON_MIN_PITCH_DEGREES = -22
const AIRCRAFT_HORIZON_MAX_PITCH_DEGREES = 16
const AIRCRAFT_HORIZON_MIN_HALF_DISTANCE_METERS = 6_000
const AIRCRAFT_HORIZON_MAX_HALF_DISTANCE_METERS = 30_000
const AIRCRAFT_HORIZON_HEIGHT_MULTIPLIER = 12
const AIRCRAFT_ICON_PATH = '/icons/plane.svg'
const EARTH_RADIUS_METERS = Cesium.Ellipsoid.WGS84.maximumRadius
const GROUND_CLEARANCE_METERS = 0.5
const scratchAircraftSurfaceCartographic = new Cesium.Cartographic()
const scratchAircraftNearSidePosition = new Cesium.Cartesian3()
const AIRCRAFT_COLORS = {
  standard: {
    marker: Cesium.Color.fromCssColorString('#f59e0b'),
    selected: Cesium.Color.fromCssColorString('#fde68a'),
    history: Cesium.Color.fromCssColorString('#fbbf24').withAlpha(0.85),
  },
  military: {
    marker: Cesium.Color.RED,
    selected: Cesium.Color.fromCssColorString('#fca5a5'),
    history: Cesium.Color.RED.withAlpha(0.85),
  },
}
const AIRCRAFT_SCALE_BY_DISTANCE = new Cesium.NearFarScalar(
  1_000_000,
  1.15,
  20_000_000,
  0.45,
)

function normalizeAngleDegrees(value) {
  return ((value % 360) + 360) % 360
}

function normalizeLongitudeDegrees(value) {
  const normalizedLongitude = ((value + 540) % 360) - 180

  return normalizedLongitude === -180 ? 180 : normalizedLongitude
}

function interpolateAngleDegrees(start, end, progress) {
  const normalizedStart = normalizeAngleDegrees(start)
  const normalizedEnd = normalizeAngleDegrees(end)
  const delta = ((normalizedEnd - normalizedStart + 540) % 360) - 180

  return normalizeAngleDegrees(normalizedStart + delta * progress)
}

function getSurfaceHeightMeters(viewer, aircraftState) {
  if (
    !viewer?.scene?.globe ||
    !aircraftState ||
    !Number.isFinite(aircraftState.lat) ||
    !Number.isFinite(aircraftState.lon)
  ) {
    return 0
  }

  const cartographic = Cesium.Cartographic.fromDegrees(
    aircraftState.lon,
    aircraftState.lat,
    0,
    scratchAircraftSurfaceCartographic,
  )
  const surfaceHeightMeters = viewer.scene.globe.getHeight(cartographic)

  return Number.isFinite(surfaceHeightMeters) ? surfaceHeightMeters : 0
}

function resolveSurfaceHeightMeters(
  viewer,
  aircraftState,
  cachedSurfaceHeightMeters = null,
) {
  if (Number.isFinite(cachedSurfaceHeightMeters)) {
    return cachedSurfaceHeightMeters
  }

  if (
    !aircraftState?.onGround &&
    Number.isFinite(aircraftState?.altitude) &&
    aircraftState.altitude > GROUND_CLEARANCE_METERS
  ) {
    return 0
  }

  return getSurfaceHeightMeters(viewer, aircraftState)
}

export function getRenderAltitudeMeters(
  aircraftState,
  { surfaceHeightMeters = 0 } = {},
) {
  const minimumAltitudeMeters =
    Math.max(0, Number(surfaceHeightMeters) || 0) + GROUND_CLEARANCE_METERS

  if (!aircraftState) {
    return minimumAltitudeMeters
  }

  if (aircraftState.onGround) {
    return minimumAltitudeMeters
  }

  if (!Number.isFinite(aircraftState.altitude)) {
    return minimumAltitudeMeters
  }

  return Math.max(minimumAltitudeMeters, aircraftState.altitude)
}

function toRenderCartesian(
  viewer,
  aircraftState,
  result,
  { surfaceHeightMeters = null } = {},
) {
  return Cesium.Cartesian3.fromDegrees(
    aircraftState.lon,
    aircraftState.lat,
    getRenderAltitudeMeters(aircraftState, {
      surfaceHeightMeters: resolveSurfaceHeightMeters(
        viewer,
        aircraftState,
        surfaceHeightMeters,
      ),
    }),
    Cesium.Ellipsoid.WGS84,
    result,
  )
}

function getBillboardVerticalOrigin(aircraftState) {
  return aircraftState?.onGround
    ? Cesium.VerticalOrigin.BOTTOM
    : Cesium.VerticalOrigin.CENTER
}

function cloneCartesianArray(positions) {
  return positions.map((position) => Cesium.Cartesian3.clone(position))
}

function getAircraftStyle(aircraftState) {
  return aircraftState?.isMilitary
    ? AIRCRAFT_COLORS.military
    : AIRCRAFT_COLORS.standard
}

function isNearSideAircraft(viewer, cameraPosition, aircraftState) {
  const normalizedCameraPosition = Cesium.Cartesian3.normalize(
    cameraPosition,
    new Cesium.Cartesian3(),
  )
  const worldPosition = Cesium.Cartesian3.fromDegrees(
    aircraftState.lon,
    aircraftState.lat,
    0,
    Cesium.Ellipsoid.WGS84,
    scratchAircraftNearSidePosition,
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

function predictAircraftState(aircraftState, deltaMs) {
  if (!aircraftState) {
    return null
  }

  const secondsAhead = Math.max(0, deltaMs) / 1000

  if (secondsAhead === 0) {
    return aircraftState
  }

  const projectedPosition = projectPosition(
    aircraftState.lat,
    aircraftState.lon,
    aircraftState.heading,
    Math.max(0, aircraftState.velocity) * secondsAhead,
  )

  return {
    ...aircraftState,
    ...projectedPosition,
    altitude: Math.max(
      0,
      aircraftState.altitude + aircraftState.verticalRate * secondsAhead,
    ),
  }
}

function interpolateAircraftState(startState, endState, progress) {
  return {
    ...endState,
    lat: Cesium.Math.lerp(startState.lat, endState.lat, progress),
    lon: interpolateAngleDegrees(startState.lon, endState.lon, progress),
    altitude: Cesium.Math.lerp(
      startState.altitude,
      endState.altitude,
      progress,
    ),
    velocity: Cesium.Math.lerp(
      startState.velocity,
      endState.velocity,
      progress,
    ),
    heading: interpolateAngleDegrees(
      startState.heading,
      endState.heading,
      progress,
    ),
    verticalRate: Cesium.Math.lerp(
      startState.verticalRate,
      endState.verticalRate,
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
      return predictAircraftState(entry.endState, extrapolationMs)
    }

    return entry.endState
  }

  return interpolateAircraftState(entry.startState, entry.endState, progress)
}

function buildSelection(entry) {
  const focusProfile = getAircraftFocusProfile(entry.aircraft)

  return {
    type: 'aircraft',
    id: entry.aircraft.icao24,
    icao24: entry.aircraft.icao24.toUpperCase(),
    callsign: entry.aircraft.callsign,
    isMilitary: entry.aircraft.isMilitary,
    altitudeMeters: entry.renderedState.altitude,
    velocityMS: entry.renderedState.velocity,
    headingDegrees: normalizeAngleDegrees(entry.renderedState.heading),
    verticalRateMS: entry.renderedState.verticalRate,
    originCountry: entry.aircraft.originCountry,
    onGround: entry.aircraft.onGround,
    dimensionsMeters: focusProfile.targetDimensions,
    moreInfoUrl: `https://opensky-network.org/?icao=${encodeURIComponent(entry.aircraft.icao24.toUpperCase())}`,
  }
}

function getEntityMetadata(entity) {
  if (!entity?.properties) {
    return null
  }

  const now = Cesium.JulianDate.now()
  const layerType = entity.properties.layerType?.getValue(now)
  const icao24 = entity.properties.icao24?.getValue(now)

  if (!layerType || !icao24) {
    return null
  }

  return {
    layerType,
    icao24,
  }
}

function updateEntryVisualState(entry, isSelected) {
  const style = getAircraftStyle(entry.aircraft)

  entry.entity.billboard.color = isSelected
    ? style.selected
    : style.marker
  entry.entity.billboard.scale = isSelected ? 1.15 : 1

  if (entry.modelEntity?.model) {
    entry.modelEntity.model.silhouetteColor = style.selected
    entry.modelEntity.model.silhouetteSize = isSelected ? 2.5 : 0
  }
}

function syncAircraftOrientationState(entry, aircraftState) {
  if (!entry || !aircraftState) {
    return
  }

  entry.renderRotationRadians = 0
  entry.alignedAxis = computeSurfaceHeadingVector(
    aircraftState,
    entry.alignedAxis ?? new Cesium.Cartesian3(),
  )
  entry.orientation = computeHeadingAlignedQuaternion(
    aircraftState,
    entry.orientation ?? new Cesium.Quaternion(),
  )
}

function getViewRectangleDegrees(viewer) {
  const viewRectangle = getHorizonAwareViewRectangleDegrees(viewer, {
    maximumCameraHeightMeters: AIRCRAFT_HORIZON_MAX_CAMERA_HEIGHT_METERS,
    minimumPitchDegrees: AIRCRAFT_HORIZON_MIN_PITCH_DEGREES,
    maximumPitchDegrees: AIRCRAFT_HORIZON_MAX_PITCH_DEGREES,
    minLocalHalfDistanceMeters: AIRCRAFT_HORIZON_MIN_HALF_DISTANCE_METERS,
    maxLocalHalfDistanceMeters: AIRCRAFT_HORIZON_MAX_HALF_DISTANCE_METERS,
    localDistanceHeightMultiplier: AIRCRAFT_HORIZON_HEIGHT_MULTIPLIER,
  })

  if (!viewRectangle) {
    return null
  }

  const latitudeSpan = Math.max(0, viewRectangle.north - viewRectangle.south)
  const longitudeSpan =
    viewRectangle.west <= viewRectangle.east
      ? viewRectangle.east - viewRectangle.west
      : 360 - viewRectangle.west + viewRectangle.east
  const latitudePadding = Math.min(
    15,
    latitudeSpan * VIEW_RECTANGLE_PADDING_RATIO,
  )
  const longitudePadding = Math.min(
    25,
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

function isAircraftWithinViewRectangle(aircraftState, viewRectangle) {
  if (!viewRectangle) {
    return true
  }

  return (
    aircraftState.lat >= viewRectangle.south &&
    aircraftState.lat <= viewRectangle.north &&
    isLongitudeWithinBounds(
      aircraftState.lon,
      viewRectangle.west,
      viewRectangle.east,
    )
  )
}

function getViewCenterDegrees(viewRectangle) {
  if (!viewRectangle) {
    return null
  }

  const longitudeSpan =
    viewRectangle.west <= viewRectangle.east
      ? viewRectangle.east - viewRectangle.west
      : 360 - viewRectangle.west + viewRectangle.east

  return {
    lat: (viewRectangle.south + viewRectangle.north) / 2,
    lon: normalizeLongitudeDegrees(
      viewRectangle.west + longitudeSpan / 2,
    ),
  }
}

function getAngularDistanceScore(aircraftState, viewCenter) {
  if (!viewCenter) {
    return 0
  }

  const longitudeDelta = Math.abs(
    normalizeLongitudeDegrees(aircraftState.lon - viewCenter.lon),
  )
  const wrappedLongitudeDelta = Math.min(longitudeDelta, 360 - longitudeDelta)
  const latitudeDelta = Math.abs(aircraftState.lat - viewCenter.lat)
  const latitudeWeight = Math.max(
    0.35,
    Math.cos(Cesium.Math.toRadians(viewCenter.lat)),
  )

  return latitudeDelta + wrappedLongitudeDelta * latitudeWeight
}

function shouldShowAircraftEntry(
  viewer,
  entry,
  cameraPosition,
  viewRectangle,
  selectedIcao24,
) {
  if (!entry?.renderedState) {
    return false
  }

  const isNearSide = isNearSideAircraft(
    viewer,
    cameraPosition,
    entry.renderedState,
  )

  if (!isNearSide) {
    return false
  }

  if (entry.aircraft.icao24 === selectedIcao24 || entry.aircraft.isMilitary) {
    return true
  }

  return isAircraftWithinViewRectangle(entry.renderedState, viewRectangle)
}

function selectAircraftForCurrentView({
  aircraftCatalog,
  viewer,
  maxAircraft,
  selectedIcao24,
  activeIcao24Set,
}) {
  const cameraPosition = viewer.camera.positionWC
  const viewRectangle = getViewRectangleDegrees(viewer)
  const viewCenter = getViewCenterDegrees(viewRectangle)
  const nearSideAircraft = aircraftCatalog.filter((aircraftState) =>
    isNearSideAircraft(viewer, cameraPosition, aircraftState),
  )
  const prioritizedMilitaryAircraft = sortAircraftForDisplay(
    nearSideAircraft.filter((aircraftState) => aircraftState.isMilitary),
  ).slice(0, maxAircraft)
  const civilianCandidates = nearSideAircraft.filter(
    (aircraftState) =>
      !aircraftState.isMilitary &&
      (
        aircraftState.icao24 === selectedIcao24 ||
        isAircraftWithinViewRectangle(aircraftState, viewRectangle)
      ),
  )
  const civilianBasePriority = new Map(
    sortAircraftForDisplay(civilianCandidates).map(
      (aircraftState, index) => [aircraftState.icao24, index],
    ),
  )
  const rankedCivilianAircraft = [...civilianCandidates].sort(
    (leftAircraft, rightAircraft) => {
      const leftIsSelected = leftAircraft.icao24 === selectedIcao24
      const rightIsSelected = rightAircraft.icao24 === selectedIcao24

      if (leftIsSelected !== rightIsSelected) {
        return Number(rightIsSelected) - Number(leftIsSelected)
      }

      const leftIsActive = activeIcao24Set.has(leftAircraft.icao24)
      const rightIsActive = activeIcao24Set.has(rightAircraft.icao24)

      if (leftIsActive !== rightIsActive) {
        return Number(rightIsActive) - Number(leftIsActive)
      }

      const viewDistanceDelta =
        getAngularDistanceScore(leftAircraft, viewCenter) -
        getAngularDistanceScore(rightAircraft, viewCenter)

      if (Math.abs(viewDistanceDelta) > 0.001) {
        return viewDistanceDelta
      }

      return (
        civilianBasePriority.get(leftAircraft.icao24) -
        civilianBasePriority.get(rightAircraft.icao24)
      )
    },
  )
  const cappedCivilianAircraft = rankedCivilianAircraft.slice(
    0,
    Math.max(0, maxAircraft - prioritizedMilitaryAircraft.length),
  )
  const desiredAircraft = []
  const seenIcao24 = new Set()

  prioritizedMilitaryAircraft.forEach((aircraftState) => {
    desiredAircraft.push(aircraftState)
    seenIcao24.add(aircraftState.icao24)
  })

  cappedCivilianAircraft.forEach((aircraftState) => {
    if (seenIcao24.has(aircraftState.icao24)) {
      return
    }

    desiredAircraft.push(aircraftState)
    seenIcao24.add(aircraftState.icao24)
  })

  return desiredAircraft
}

export function createAircraftLayer({
  viewer,
  maxAircraft = DEFAULT_AIRCRAFT_LIMIT,
  initialTimeMs = Date.now(),
  onSelectionChange,
}) {
  const dataSource = new Cesium.CustomDataSource('aircraft')
  const aircraftEntries = new Map()
  const selectedOverlayState = {
    historyPositions: [],
  }

  let attached = false
  let destroyed = false
  let visible = false
  let selectedIcao24 = null
  let fetchIntervalId = null
  let animationFrameId = null
  let loadPromise = null
  let selectedHistoryEntity = null
  let latestAircraftCatalog = []
  let removeCameraChangedListener = null
  let cameraRefreshTimeoutId = null
  let currentTimeMs = Number.isFinite(Number(initialTimeMs))
    ? Number(initialTimeMs)
    : Date.now()

  const isLiveTimeline = () =>
    useTimeStore.getState().liveMode || isLiveTimestamp(currentTimeMs)

  const emitSelection = (entry) => {
    onSelectionChange?.(entry ? buildSelection(entry) : null)
  }

  const requestRender = () => {
    try {
      if (!viewer.isDestroyed()) {
        viewer.scene.requestRender()
      }
    } catch {
      // The viewer can disappear during HMR or React cleanup; rendering is no-op then.
    }
  }

  const isEntryVisible = (entry) => Boolean(entry?.entity?.show || entry?.modelEntity?.show)

  const syncEntryEntityVisibility = (entry, cameraPosition, viewRectangle) => {
    const shouldShow = shouldShowAircraftEntry(
      viewer,
      entry,
      cameraPosition,
      viewRectangle,
      selectedIcao24,
    )
    const shouldShowModel = shouldShow && entry.aircraft.icao24 === selectedIcao24

    entry.entity.show = shouldShow && !shouldShowModel

    if (entry.modelEntity) {
      entry.modelEntity.show = shouldShowModel
    }
  }

  const stopAnimationLoop = () => {
    if (animationFrameId) {
      window.cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }
  }

  const ensureAnimationLoop = () => {
    if (
      animationFrameId ||
      !visible ||
      destroyed ||
      !isLiveTimeline() ||
      aircraftEntries.size === 0
    ) {
      return
    }

    animationFrameId = window.requestAnimationFrame(animate)
  }

  const clearCameraRefreshTimeout = () => {
    if (cameraRefreshTimeoutId !== null) {
      window.clearTimeout(cameraRefreshTimeoutId)
      cameraRefreshTimeoutId = null
    }
  }

  const hideSelectedOverlays = () => {
    selectedOverlayState.historyPositions = []

    if (selectedHistoryEntity) {
      selectedHistoryEntity.show = false
      selectedHistoryEntity.properties = {
        layerType: 'aircraft-helper',
      }
    }
  }

  const createSelectedOverlayEntities = () => {
    if (selectedHistoryEntity) {
      return
    }

    selectedHistoryEntity = dataSource.entities.add({
      id: 'aircraft-selected-history',
      show: false,
      polyline: {
        positions: new Cesium.CallbackProperty(
          () => selectedOverlayState.historyPositions,
          false,
        ),
        width: 2,
        material: AIRCRAFT_COLORS.standard.history,
        arcType: Cesium.ArcType.NONE,
      },
      properties: {
        layerType: 'aircraft-helper',
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

  const syncSelectedOverlays = (entry) => {
    if (!selectedHistoryEntity || !entry) {
      hideSelectedOverlays()
      return
    }

    if (!isEntryVisible(entry)) {
      hideSelectedOverlays()
      return
    }

    // Historical aircraft positions are session snapshots, not archival truth,
    // so we only show path overlays while the layer is tracking live updates.
    if (!isLiveTimeline()) {
      hideSelectedOverlays()
      return
    }

    const style = getAircraftStyle(entry.aircraft)
    const historyPositions = buildHistoryOverlayPositions(entry)

    selectedOverlayState.historyPositions = historyPositions

    selectedHistoryEntity.polyline.material = style.history
    selectedHistoryEntity.show = historyPositions.length > 1
    selectedHistoryEntity.properties = {
      layerType: 'aircraft',
      icao24: entry.aircraft.icao24,
      callsign: entry.aircraft.callsign,
    }
  }

  const cancelLoops = () => {
    if (fetchIntervalId) {
      window.clearInterval(fetchIntervalId)
      fetchIntervalId = null
    }

    stopAnimationLoop()
  }

  const getPlaybackCatalog = () => {
    const aircraftSnapshots = useTimeStore
      .getState()
      .getSnapshots('aircraft')
    const { before, after } = findSurroundingSnapshots(
      aircraftSnapshots,
      currentTimeMs,
    )

    return interpolateAircraftCatalogSnapshots(before, after, currentTimeMs)
  }

  const getDisplayCatalog = () =>
    isLiveTimeline() ? latestAircraftCatalog : getPlaybackCatalog()

  const clearSelection = () => {
    if (selectedIcao24) {
      const selectedEntry = aircraftEntries.get(selectedIcao24)

      if (selectedEntry) {
        updateEntryVisualState(selectedEntry, false)
        selectedIcao24 = null
        syncEntryEntityVisibility(
          selectedEntry,
          viewer.camera.positionWC,
          getViewRectangleDegrees(viewer),
        )
      } else {
        selectedIcao24 = null
      }
    } else {
      selectedIcao24 = null
    }

    hideSelectedOverlays()
    emitSelection(null)
    requestRender()
  }

  const removeEntry = (icao24) => {
    const entry = aircraftEntries.get(icao24)

    if (!entry) {
      return
    }

    if (selectedIcao24 === icao24) {
      clearSelection()
    }

    dataSource.entities.remove(entry.entity)
    if (entry.modelEntity) {
      dataSource.entities.remove(entry.modelEntity)
    }
    aircraftEntries.delete(icao24)
  }

  const resetEntries = () => {
    dataSource.entities.removeAll()
    aircraftEntries.clear()
    selectedIcao24 = null
    selectedHistoryEntity = null
    hideSelectedOverlays()
  }

  const pushHistorySample = (
    entry,
    aircraftState,
    timestampMs,
    { reset = false } = {},
  ) => {
    if (reset) {
      entry.historyPositions = []
      entry.lastHistoryTimestampMs = null
    }

    if (!aircraftState || aircraftState.onGround) {
      return
    }

    if (
      entry.lastHistoryTimestampMs !== null &&
      timestampMs - entry.lastHistoryTimestampMs < HISTORY_SAMPLE_INTERVAL_MS
    ) {
      return
    }

    entry.historyPositions.push(toRenderCartesian(viewer, aircraftState))

    if (entry.historyPositions.length > MAX_HISTORY_SAMPLES) {
      entry.historyPositions.shift()
    }

    entry.lastHistoryTimestampMs = timestampMs
  }

  const createEntry = (aircraft, nowMs, { playbackMode = false } = {}) => {
    const predictedState = playbackMode
      ? aircraft
      : predictAircraftState(aircraft, AIRCRAFT_PREDICTION_MS)
    const surfaceHeightMeters = resolveSurfaceHeightMeters(
      viewer,
      aircraft,
    )
    const entry = {
      aircraft,
      startState: aircraft,
      endState: predictedState,
      renderedState: aircraft,
      startTimeMs: nowMs,
      endTimeMs: playbackMode ? nowMs : nowMs + AIRCRAFT_POLL_MS,
      historyPositions: [],
      lastHistoryTimestampMs: null,
      surfaceHeightMeters,
      renderCartesian: toRenderCartesian(viewer, aircraft, undefined, {
        surfaceHeightMeters,
      }),
      renderRotationRadians: 0,
      alignedAxis: computeSurfaceHeadingVector(
        aircraft,
        new Cesium.Cartesian3(),
      ),
      orientation: computeHeadingAlignedQuaternion(
        aircraft,
        new Cesium.Quaternion(),
      ),
      focusProfile: getAircraftFocusProfile(aircraft),
      entity: null,
      modelEntity: null,
    }

    entry.entity = dataSource.entities.add({
      id: `aircraft-${aircraft.icao24}`,
      show: true,
      position: new Cesium.CallbackProperty(
        (_time, result) =>
          Cesium.Cartesian3.clone(entry.renderCartesian, result),
        false,
      ),
      billboard: {
        image: AIRCRAFT_ICON_PATH,
        color: getAircraftStyle(aircraft).marker,
        scale: 1,
        width: 20,
        height: 20,
        alignedAxis: new Cesium.CallbackProperty(
          (_time, result) => Cesium.Cartesian3.clone(entry.alignedAxis, result),
          false,
        ),
        rotation: new Cesium.CallbackProperty(
          () => entry.renderRotationRadians,
          false,
        ),
        scaleByDistance: AIRCRAFT_SCALE_BY_DISTANCE,
        verticalOrigin: new Cesium.CallbackProperty(
          () => getBillboardVerticalOrigin(entry.renderedState),
          false,
        ),
      },
      properties: {
        layerType: 'aircraft',
        icao24: aircraft.icao24,
        callsign: aircraft.callsign,
      },
    })

    entry.modelEntity = dataSource.entities.add({
      id: `aircraft-model-${aircraft.icao24}`,
      show: false,
      position: new Cesium.CallbackProperty(
        (_time, result) =>
          Cesium.Cartesian3.clone(entry.renderCartesian, result),
        false,
      ),
      orientation: new Cesium.CallbackProperty(
        (_time, result) => Cesium.Quaternion.clone(entry.orientation, result),
        false,
      ),
      model: {
        uri: entry.focusProfile.modelPath,
        scale: entry.focusProfile.modelScale,
        minimumPixelSize: 0,
        runAnimations: false,
      },
      properties: {
        layerType: 'aircraft',
        icao24: aircraft.icao24,
        callsign: aircraft.callsign,
      },
    })

    if (!playbackMode) {
      pushHistorySample(entry, aircraft, nowMs, { reset: true })
    }
    updateEntryVisualState(entry, false)
    aircraftEntries.set(aircraft.icao24, entry)
    return entry
  }

  const animate = () => {
    if (destroyed || !visible) {
      return
    }

    if (!isLiveTimeline()) {
      animationFrameId = null
      requestRender()
      return
    }

    if (aircraftEntries.size === 0) {
      animationFrameId = null
      requestRender()
      return
    }

    const nowMs = Date.now()
    const cameraPosition = viewer.camera.positionWC
    const viewRectangle = getViewRectangleDegrees(viewer)

    aircraftEntries.forEach((entry) => {
      const renderedState = getRenderedState(entry, nowMs)

      if (!renderedState) {
        return
      }

      entry.renderedState = renderedState
      syncAircraftOrientationState(entry, renderedState)
      toRenderCartesian(viewer, renderedState, entry.renderCartesian, {
        surfaceHeightMeters: entry.surfaceHeightMeters,
      })
      syncEntryEntityVisibility(entry, cameraPosition, viewRectangle)
    })

    if (selectedIcao24) {
      const selectedEntry = aircraftEntries.get(selectedIcao24)

      if (selectedEntry) {
        syncSelectedOverlays(selectedEntry)
        emitSelection(selectedEntry)
      } else {
        hideSelectedOverlays()
      }
    }

    requestRender()
    animationFrameId = window.requestAnimationFrame(animate)
  }

  const reconcileVisibleAircraft = (
    catalog = getDisplayCatalog(),
    { playbackMode = !isLiveTimeline() } = {},
  ) => {
    if (destroyed || !visible) {
      return
    }

    if (!selectedHistoryEntity) {
      createSelectedOverlayEntities()
    }

    if (!catalog.length) {
      stopAnimationLoop()
      aircraftEntries.forEach((_entry, icao24) => {
        removeEntry(icao24)
      })
      hideSelectedOverlays()
      requestRender()
      return
    }

    const nowMs = playbackMode ? currentTimeMs : Date.now()
    const cameraPosition = viewer.camera.positionWC
    const viewRectangle = getViewRectangleDegrees(viewer)
    const desiredAircraft = selectAircraftForCurrentView({
      aircraftCatalog: catalog,
      viewer,
      maxAircraft,
      selectedIcao24,
      activeIcao24Set: new Set(aircraftEntries.keys()),
    })
    const desiredIcao24Set = new Set(
      desiredAircraft.map((aircraftState) => aircraftState.icao24),
    )

    desiredAircraft.forEach((aircraft) => {
      if (!aircraftEntries.has(aircraft.icao24)) {
        const entry = createEntry(aircraft, nowMs, { playbackMode })
        syncEntryEntityVisibility(entry, cameraPosition, viewRectangle)
        return
      }

      const entry = aircraftEntries.get(aircraft.icao24)
      const renderedState = getRenderedState(entry, nowMs) ?? entry.endState
      const predictedState = playbackMode
        ? aircraft
        : predictAircraftState(aircraft, AIRCRAFT_PREDICTION_MS)
      const justTookOff = entry.aircraft.onGround && !aircraft.onGround
      const justLanded = !entry.aircraft.onGround && aircraft.onGround

      entry.aircraft = aircraft
      entry.focusProfile = getAircraftFocusProfile(aircraft)
      entry.surfaceHeightMeters = resolveSurfaceHeightMeters(
        viewer,
        aircraft,
        aircraft.onGround ? null : 0,
      )
      entry.startState = playbackMode ? aircraft : renderedState
      entry.endState = predictedState
      entry.renderedState = playbackMode ? aircraft : renderedState
      entry.startTimeMs = nowMs
      entry.endTimeMs = playbackMode ? nowMs : nowMs + AIRCRAFT_POLL_MS
      syncAircraftOrientationState(entry, entry.renderedState)
      entry.entity.properties = {
        layerType: 'aircraft',
        icao24: aircraft.icao24,
        callsign: aircraft.callsign,
      }
      if (entry.modelEntity) {
        entry.modelEntity.model.uri = entry.focusProfile.modelPath
        entry.modelEntity.model.scale = entry.focusProfile.modelScale
        entry.modelEntity.properties = {
          layerType: 'aircraft',
          icao24: aircraft.icao24,
          callsign: aircraft.callsign,
        }
      }
      syncEntryEntityVisibility(entry, cameraPosition, viewRectangle)
      updateEntryVisualState(entry, selectedIcao24 === aircraft.icao24)

      if (justLanded) {
        entry.historyPositions = []
        entry.lastHistoryTimestampMs = null
        return
      }

      if (!playbackMode) {
        pushHistorySample(entry, aircraft, nowMs, {
          reset: justTookOff,
        })
      }
    })

    aircraftEntries.forEach((_entry, icao24) => {
      if (!desiredIcao24Set.has(icao24)) {
        removeEntry(icao24)
      }
    })

    requestRender()
  }

  const queueCameraRefresh = () => {
    if (
      !visible ||
      destroyed ||
      cameraRefreshTimeoutId !== null ||
      !getDisplayCatalog().length
    ) {
      return
    }

    cameraRefreshTimeoutId = window.setTimeout(() => {
      cameraRefreshTimeoutId = null
      reconcileVisibleAircraft(getDisplayCatalog(), {
        playbackMode: !isLiveTimeline(),
      })
    }, CAMERA_REFRESH_MS)
  }

  const syncAircraft = async () => {
    const nextAircraftResponse = await fetchAircraft()

    if (destroyed || !visible) {
      return
    }

    if (
      !nextAircraftResponse.states.length &&
      latestAircraftCatalog.length > 0
    ) {
      reconcileVisibleAircraft(getDisplayCatalog(), {
        playbackMode: !isLiveTimeline(),
      })
      return
    }

    latestAircraftCatalog = nextAircraftResponse.states
    if (nextAircraftResponse.states.length) {
      useTimeStore.getState().addSnapshot({
        timestamp: nextAircraftResponse.timestampMs,
        aircraftCatalog: nextAircraftResponse.states,
      })
    }

    reconcileVisibleAircraft(getDisplayCatalog(), {
      playbackMode: !isLiveTimeline(),
    })

    if (isLiveTimeline()) {
      ensureAnimationLoop()
    }
  }

  const attachDataSource = async () => {
    if (attached || destroyed) {
      return
    }

    await viewer.dataSources.add(dataSource)
    attached = true
    createSelectedOverlayEntities()
    removeCameraChangedListener = viewer.camera.changed.addEventListener(() => {
      queueCameraRefresh()
    })
  }

  const ensureLoaded = async () => {
    if (destroyed) {
      return
    }

    if (!loadPromise) {
      loadPromise = syncAircraft().finally(() => {
        loadPromise = null
      })
    }

    await loadPromise
  }

  return {
    async show() {
      if (destroyed) {
        return
      }

      visible = true
      await attachDataSource()
      await ensureLoaded()

      if (!visible || destroyed) {
        return
      }

      dataSource.show = true
      cancelLoops()
      clearCameraRefreshTimeout()
      fetchIntervalId = window.setInterval(() => {
        syncAircraft().catch((error) => {
          console.error('Unable to update aircraft state data.', error)
        })
      }, AIRCRAFT_POLL_MS)
      ensureAnimationLoop()
      reconcileVisibleAircraft(getDisplayCatalog(), {
        playbackMode: !isLiveTimeline(),
      })
      requestRender()
    },

    hide() {
      visible = false
      cancelLoops()
      clearCameraRefreshTimeout()
      dataSource.show = false
      clearSelection()
      resetEntries()
      requestRender()
    },

    handlePick(pickedObject) {
      if (!Cesium.defined(pickedObject) || !Cesium.defined(pickedObject.id)) {
        return false
      }

      const metadata = getEntityMetadata(pickedObject.id)

      if (!metadata || metadata.layerType !== 'aircraft') {
        return false
      }

      const entry = aircraftEntries.get(metadata.icao24)

      if (!entry) {
        return false
      }

      if (selectedIcao24 && selectedIcao24 !== metadata.icao24) {
        const previousEntry = aircraftEntries.get(selectedIcao24)

        if (previousEntry) {
          updateEntryVisualState(previousEntry, false)
        }
      }

      selectedIcao24 = metadata.icao24
      reconcileVisibleAircraft(getDisplayCatalog(), {
        playbackMode: !isLiveTimeline(),
      })

      const selectedEntry = aircraftEntries.get(metadata.icao24)

      if (!selectedEntry) {
        return false
      }

      updateEntryVisualState(selectedEntry, true)
      syncSelectedOverlays(selectedEntry)
      emitSelection(selectedEntry)
      requestRender()
      return true
    },

    setTime(nextTimeMs) {
      const parsedTimeMs = Number(nextTimeMs)

      if (!Number.isFinite(parsedTimeMs)) {
        return
      }

      currentTimeMs = parsedTimeMs

      if (!visible || destroyed) {
        return
      }

      if (isLiveTimeline()) {
        ensureAnimationLoop()
      } else {
        stopAnimationLoop()
      }

      reconcileVisibleAircraft(getDisplayCatalog(), {
        playbackMode: !isLiveTimeline(),
      })
    },

    clearSelection,

    getFocusTarget() {
      if (!selectedIcao24) {
        return null
      }

      const selectedEntry = aircraftEntries.get(selectedIcao24)

      if (!selectedEntry?.modelEntity) {
        return null
      }

      return {
        entity: selectedEntry.modelEntity,
        focus: selectedEntry.focusProfile?.focus,
      }
    },

    destroy() {
      destroyed = true
      cancelLoops()
      clearCameraRefreshTimeout()
      clearSelection()
      latestAircraftCatalog = []
      resetEntries()

      if (removeCameraChangedListener) {
        removeCameraChangedListener()
        removeCameraChangedListener = null
      }

      if (attached && !viewer.isDestroyed()) {
        viewer.dataSources.remove(dataSource, true)
      }

      attached = false
    },
  }
}
