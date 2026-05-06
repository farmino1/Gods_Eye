import * as Cesium from 'cesium'
import {
  DEFAULT_SATELLITE_LIMIT,
  fetchAllSatelliteTles,
  sampleSatellitesWithMilitaryPriority,
} from '../services/satellites'
import {
  getOrbitTrail,
  getSatelliteState,
} from '../utils/orbit'

const POSITION_UPDATE_MS = 1_000
const TRAIL_UPDATE_MS = 60_000
const ORBIT_STEP_MINUTES = 3
const MAX_VISIBLE_TRAIL_SEGMENTS = 3
const CAMERA_TRAIL_REFRESH_MS = 120
const DEFAULT_VISION_CONE_HALF_ANGLE_DEGREES = 12
// Narrowing factor: multiply the geometric earth-angular half-angle by this
// to make visualization cones narrower than the theoretical horizon
// intersection. Factor is halfway between original (1.0) and previous
// narrowed value (0.25) to produce a medium-width cone.
const VISION_CONE_NARROWING_FACTOR = 0.625
const MIN_VISION_CONE_HALF_ANGLE_DEGREES = 1
const MIN_VISION_CONE_HALF_ANGLE_RADIANS = Cesium.Math.toRadians(
  MIN_VISION_CONE_HALF_ANGLE_DEGREES,
)
const EARTH_RADIUS_METERS = Cesium.Ellipsoid.WGS84.maximumRadius
const SATELLITE_COLORS = {
  standard: Cesium.Color.CYAN,
  standardTrail: Cesium.Color.CYAN.withAlpha(0.35),
  military: Cesium.Color.RED,
  militaryTrail: Cesium.Color.RED.withAlpha(0.45),
}

function toCartesian(position) {
  return Cesium.Cartesian3.fromDegrees(
    position.lon,
    position.lat,
    position.height,
  )
}

function toFixedFrameCartesian(position) {
  return new Cesium.Cartesian3(position.x, position.y, position.z)
}

function createVisibilityContext(viewer) {
  return new Cesium.EllipsoidalOccluder(
    viewer.scene.globe.ellipsoid,
    viewer.camera.positionWC,
  )
}

function isVisiblePosition(occluder, worldPosition) {
  return Boolean(worldPosition) && occluder.isPointVisible(worldPosition)
}

function splitVisibleTrailSegments(trailPositions, occluder) {
  const visibleSegments = []
  let currentSegment = []

  trailPositions.forEach((trailPosition) => {
    if (isVisiblePosition(occluder, trailPosition)) {
      currentSegment.push(trailPosition)
      return
    }

    if (currentSegment.length > 1) {
      visibleSegments.push(currentSegment)
    }

    currentSegment = []
  })

  if (currentSegment.length > 1) {
    visibleSegments.push(currentSegment)
  }

  return visibleSegments
}

function getSatcatUrl(noradId) {
  return `https://www.satcat.com/sats/${encodeURIComponent(noradId)}`
}

function buildSelection(entry) {
  return {
    type: 'satellite',
    id: entry.tle.noradId,
    name: entry.tle.name,
    noradId: entry.tle.noradId,
    isMilitary: entry.tle.isMilitary,
    altitudeKm: entry.currentPosition.height / 1000,
    velocityKmS: entry.currentVelocityKmS,
    satcatUrl: getSatcatUrl(entry.tle.noradId),
  }
}

function getSatelliteStyle(tle) {
  if (tle.isMilitary) {
    return {
      pointColor: SATELLITE_COLORS.military,
      trailColor: SATELLITE_COLORS.militaryTrail,
    }
  }

  return {
    pointColor: SATELLITE_COLORS.standard,
    trailColor: SATELLITE_COLORS.standardTrail,
  }
}

function getVisionConeHalfAngleRadians(heightMeters) {
  if (!Number.isFinite(heightMeters) || heightMeters <= 0) {
    return Cesium.Math.toRadians(DEFAULT_VISION_CONE_HALF_ANGLE_DEGREES)
  }

  const orbitalRadius = EARTH_RADIUS_METERS + heightMeters
  const earthAngularRadius = Math.asin(
    Cesium.Math.clamp(EARTH_RADIUS_METERS / orbitalRadius, 0, 0.999999),
  )

  if (!Number.isFinite(earthAngularRadius) || earthAngularRadius <= 0) {
    return Cesium.Math.toRadians(DEFAULT_VISION_CONE_HALF_ANGLE_DEGREES)
  }

  // Make visualization cones narrower than the theoretical horizon cone by
  // applying a narrowing factor and clamping to a small minimum so cones are
  // still visible for high-altitude satellites.
  const narrowed = Math.max(
    MIN_VISION_CONE_HALF_ANGLE_RADIANS,
    earthAngularRadius * VISION_CONE_NARROWING_FACTOR,
  )

  return narrowed
}

function getEntityMetadata(entity) {
  if (!entity?.properties) {
    return null
  }

  const now = Cesium.JulianDate.now()
  const layerType = entity.properties.layerType?.getValue(now)
  const noradId = entity.properties.noradId?.getValue(now)

  if (!layerType || !noradId) {
    return null
  }

  return {
    layerType,
    noradId,
  }
}

export function createSatelliteLayer({
  viewer,
  maxSatellites = DEFAULT_SATELLITE_LIMIT,
  initialTimeMs = Date.now(),
  onCatalogChange,
  onSelectionChange,
}) {
  const dataSource = new Cesium.CustomDataSource('satellites')
  const satelliteEntries = []
  const entityLookup = new Map()
  const visionConeState = {
    position: Cesium.Cartesian3.clone(Cesium.Cartesian3.ZERO),
    length: 1,
    bottomRadius: 1,
    orientation: Cesium.Quaternion.clone(Cesium.Quaternion.IDENTITY),
  }

  let attached = false
  let destroyed = false
  let loaded = false
  let visible = false
  let selectedNoradId = null
  let activeMaxSatellites = maxSatellites
  let loadPromise = null
  let positionIntervalId = null
  let trailIntervalId = null
  let removeCameraChangedListener = null
  let cameraVisibilityUpdateTimeoutId = null
  let visionConeEntity = null
  let currentTimeMs = Number.isFinite(Number(initialTimeMs))
    ? Number(initialTimeMs)
    : Date.now()
  let lastPositionUpdateTimeMs = null
  let lastTrailUpdateTimeMs = null

  const getDisplayTime = () => new Date(currentTimeMs)

  const emitSelection = (entry) => {
    onSelectionChange?.(entry ? buildSelection(entry) : null)
  }

  const stopTimers = () => {
    if (positionIntervalId) {
      window.clearInterval(positionIntervalId)
      positionIntervalId = null
    }

    if (trailIntervalId) {
      window.clearInterval(trailIntervalId)
      trailIntervalId = null
    }
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

  const clearCameraVisibilityTimeout = () => {
    if (cameraVisibilityUpdateTimeoutId !== null) {
      window.clearTimeout(cameraVisibilityUpdateTimeoutId)
      cameraVisibilityUpdateTimeoutId = null
    }
  }

  const createVisionConeEntity = () =>
    dataSource.entities.add({
      id: 'satellite-vision-cone',
      show: false,
      position: new Cesium.CallbackProperty(
        (_time, result) =>
          Cesium.Cartesian3.clone(visionConeState.position, result),
        false,
      ),
      orientation: new Cesium.CallbackProperty((_, result) =>
        Cesium.Quaternion.clone(visionConeState.orientation, result),
        false,
      ),
      cylinder: {
        length: new Cesium.CallbackProperty(
          () => visionConeState.length,
          false,
        ),
        topRadius: 0,
        bottomRadius: new Cesium.CallbackProperty(
          () => visionConeState.bottomRadius,
          false,
        ),
        material: Cesium.Color.CYAN.withAlpha(0.14),
        outline: true,
        outlineColor: Cesium.Color.CYAN.withAlpha(0.35),
        numberOfVerticalLines: 0,
        slices: 32,
      },
      properties: {
        layerType: 'satellite-helper',
      },
    })

  const hideVisionCone = () => {
    if (!visionConeEntity) {
      return
    }

    visionConeEntity.show = false
    visionConeEntity.properties = {
      layerType: 'satellite-helper',
    }
  }

  const syncVisionCone = (entry) => {
    if (!visionConeEntity || !entry?.currentPosition) {
      hideVisionCone()
      return
    }
    const satellitePosition = toCartesian(entry.currentPosition)

    // Use Earth's center as the cone base so the cone fully intersects
    // the globe surface. Compute length from satellite to origin and set
    // the cone center at the midpoint between them.
    const earthCenter = Cesium.Cartesian3.ZERO
    const coneLength = Cesium.Cartesian3.distance(satellitePosition, earthCenter)

    if (!Number.isFinite(coneLength) || coneLength <= 0) {
      hideVisionCone()
      return
    }

    const coneCenter = Cesium.Cartesian3.midpoint(
      satellitePosition,
      earthCenter,
      new Cesium.Cartesian3(),
    )
    const style = getSatelliteStyle(entry.tle)
    const coneHalfAngleRadians = getVisionConeHalfAngleRadians(
      entry.currentPosition.height,
    )
    const baseRadius =
      Math.tan(coneHalfAngleRadians) * coneLength
    // Compute orientation so the cylinder axis points from Earth's center
    // toward the satellite (so the cone's tip aligns with the satellite).
    const axis = Cesium.Cartesian3.normalize(satellitePosition, new Cesium.Cartesian3())
    const zAxis = Cesium.Cartesian3.clone(Cesium.Cartesian3.UNIT_Z, new Cesium.Cartesian3())
    const rotationAxis = Cesium.Cartesian3.cross(zAxis, axis, new Cesium.Cartesian3())
    const dot = Cesium.Cartesian3.dot(zAxis, axis)
    const clampedDot = Cesium.Math.clamp(dot, -1, 1)
    const angle = Math.acos(clampedDot)

    let quat = Cesium.Quaternion.clone(Cesium.Quaternion.IDENTITY)

    if (Cesium.Cartesian3.magnitudeSquared(rotationAxis) <= Cesium.Math.EPSILON10) {
      // Axis is parallel/anti-parallel to Z
      if (clampedDot < 0) {
        // Opposite direction: rotate 180deg around X to flip
        quat = Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.UNIT_X, Math.PI)
      } else {
        quat = Cesium.Quaternion.clone(Cesium.Quaternion.IDENTITY)
      }
    } else {
      Cesium.Cartesian3.normalize(rotationAxis, rotationAxis)
      quat = Cesium.Quaternion.fromAxisAngle(rotationAxis, angle)
    }

    visionConeState.position = coneCenter
    visionConeState.length = coneLength
    visionConeState.bottomRadius = baseRadius
    visionConeState.orientation = quat
    visionConeEntity.show = true
    visionConeEntity.cylinder.topRadius = 0
    visionConeEntity.cylinder.material = style.pointColor.withAlpha(0.14)
    visionConeEntity.cylinder.outlineColor = style.pointColor.withAlpha(0.32)
    visionConeEntity.properties = {
      layerType: 'satellite',
      noradId: entry.tle.noradId,
      name: entry.tle.name,
    }
  }

  const hideTrailEntities = (entry) => {
    entry.trailEntities.forEach((trailEntity) => {
      trailEntity.show = false
      trailEntity.polyline.positions = []
    })
  }

  const syncPointVisibility = (entry, occluder) => {
    entry.isVisible = isVisiblePosition(occluder, entry.currentCartesian)
    entry.pointEntity.show = entry.isVisible
  }

  const shouldRenderTrailForEntry = (entry) =>
    entry.tle.noradId === selectedNoradId

  const hasRenderableTrails = () =>
    selectedNoradId !== null

  const clearSelection = () => {
    selectedNoradId = null
    emitSelection(null)
    hideVisionCone()
    satelliteEntries.forEach((entry) => {
      entry.trailPositions = []
      hideTrailEntities(entry)
    })
    requestRender()
  }

  const syncTrailEntities = (entry, occluder = createVisibilityContext(viewer)) => {
    if (!entry.trailPositions.length || !shouldRenderTrailForEntry(entry)) {
      hideTrailEntities(entry)
      return
    }

    const visibleSegments = splitVisibleTrailSegments(
      entry.trailPositions,
      occluder,
    )

    entry.trailEntities.forEach((trailEntity, index) => {
      const segmentPositions = visibleSegments[index]

      if (segmentPositions && segmentPositions.length > 1) {
        trailEntity.show = true
        trailEntity.polyline.positions = segmentPositions
        return
      }

      trailEntity.show = false
      trailEntity.polyline.positions = []
    })
  }

  const updateTrailVisibility = (occluder = createVisibilityContext(viewer)) => {
    if (!hasRenderableTrails()) {
      satelliteEntries.forEach(hideTrailEntities)
      requestRender()
      return
    }

    satelliteEntries.forEach((entry) => {
      if (!shouldRenderTrailForEntry(entry) || !entry.trailPositions.length) {
        hideTrailEntities(entry)
        return
      }

      syncTrailEntities(entry, occluder)
    })

    requestRender()
  }

  const updateVisibilityFromCamera = () => {
    if (!visible || destroyed || !loaded) {
      return
    }

    const occluder = createVisibilityContext(viewer)
    let selectedEntry = null

    satelliteEntries.forEach((entry) => {
      syncPointVisibility(entry, occluder)

      if (selectedNoradId === entry.tle.noradId) {
        selectedEntry = entry
      }
    })

    if (selectedEntry?.isVisible) {
      syncVisionCone(selectedEntry)
    } else {
      hideVisionCone()
    }

    updateTrailVisibility(occluder)
  }

  const queueCameraVisibilityUpdate = () => {
    if (
      !visible ||
      destroyed ||
      cameraVisibilityUpdateTimeoutId !== null
    ) {
      return
    }

    cameraVisibilityUpdateTimeoutId = window.setTimeout(() => {
      cameraVisibilityUpdateTimeoutId = null
      updateVisibilityFromCamera()
    }, CAMERA_TRAIL_REFRESH_MS)
  }

  const updatePositions = (updateTime = new Date()) => {
    const occluder = createVisibilityContext(viewer)
    let selectedEntry = null

    satelliteEntries.forEach((entry) => {
      const nextState = getSatelliteState(entry.tle, updateTime)

      if (!nextState) {
        entry.currentCartesian = null
        entry.isVisible = false
        entry.pointEntity.show = false
        entry.trailPositions = []
        hideTrailEntities(entry)
        return
      }

      entry.currentPosition = {
        lat: nextState.lat,
        lon: nextState.lon,
        height: nextState.height,
      }
      entry.currentVelocityKmS = nextState.velocityKmS
      entry.currentCartesian = toCartesian(entry.currentPosition)
      entry.pointEntity.position = entry.currentCartesian
      syncPointVisibility(entry, occluder)

      if (selectedNoradId === entry.tle.noradId) {
        selectedEntry = entry
        emitSelection(entry)
      }
    })

    if (selectedEntry?.isVisible) {
      syncVisionCone(selectedEntry)
    } else {
      hideVisionCone()
    }

    requestRender()
  }

  const updateTrails = (updateTime = new Date()) => {
    if (!hasRenderableTrails()) {
      satelliteEntries.forEach((entry) => {
        entry.trailPositions = []
        hideTrailEntities(entry)
      })
      requestRender()
      return
    }

    satelliteEntries.forEach((entry) => {
      if (!shouldRenderTrailForEntry(entry)) {
        entry.trailPositions = []
        hideTrailEntities(entry)
        return
      }

      const trail = getOrbitTrail(
        entry.tle,
        updateTime,
        null,
        ORBIT_STEP_MINUTES,
      )

      if (trail.length > 1) {
        entry.trailPositions = trail.map(toFixedFrameCartesian)
        syncTrailEntities(entry)
        return
      }

      entry.trailPositions = []
      hideTrailEntities(entry)
    })

    requestRender()
  }

  const startTimers = () => {
    stopTimers()
    updatePositions(getDisplayTime())
    if (hasRenderableTrails()) {
      updateTrails(getDisplayTime())
    } else {
      satelliteEntries.forEach(hideTrailEntities)
    }
    lastPositionUpdateTimeMs = currentTimeMs
    lastTrailUpdateTimeMs = currentTimeMs

    positionIntervalId = window.setInterval(() => {
      if (currentTimeMs === lastPositionUpdateTimeMs) {
        return
      }

      updatePositions(getDisplayTime())
      lastPositionUpdateTimeMs = currentTimeMs
    }, POSITION_UPDATE_MS)

    trailIntervalId = window.setInterval(() => {
      if (!hasRenderableTrails() || currentTimeMs === lastTrailUpdateTimeMs) {
        return
      }

      updateTrails(getDisplayTime())
      lastTrailUpdateTimeMs = currentTimeMs
    }, TRAIL_UPDATE_MS)
  }

  const attachDataSource = async () => {
    if (attached || destroyed) {
      return
    }

    await viewer.dataSources.add(dataSource)
    attached = true
    removeCameraChangedListener = viewer.camera.changed.addEventListener(() => {
      queueCameraVisibilityUpdate()
    })
  }

  const rebuildEntities = async () => {
    const allSatellites = await fetchAllSatelliteTles()
    const now = new Date()
    const validSatellites = allSatellites.filter((satelliteTle) =>
      Boolean(getSatelliteState(satelliteTle, now)),
    )
    const validMilitarySatellites = validSatellites.filter(
      (satelliteTle) => satelliteTle.isMilitary,
    )

    onCatalogChange?.({
      satelliteTotal: validSatellites.length,
      militarySatelliteTotal: validMilitarySatellites.length,
    })

    const sampledSatellites = sampleSatellitesWithMilitaryPriority(
      validSatellites,
      activeMaxSatellites,
    )

    dataSource.entities.removeAll()
    satelliteEntries.length = 0
    entityLookup.clear()
    visionConeEntity = createVisionConeEntity()

    sampledSatellites.forEach((tle) => {
      const currentState = getSatelliteState(tle, now)

      if (!currentState) {
        return
      }

      const currentPosition = {
        lat: currentState.lat,
        lon: currentState.lon,
        height: currentState.height,
      }
      const currentVelocityKmS = currentState.velocityKmS
      const style = getSatelliteStyle(tle)

      const pointEntity = dataSource.entities.add({
        id: `satellite-point-${tle.noradId}`,
        position: toCartesian(currentPosition),
        point: {
          color: style.pointColor,
          outlineColor: Cesium.Color.WHITE.withAlpha(0.8),
          outlineWidth: 1,
          pixelSize: 5,
        },
        properties: {
          layerType: 'satellite',
          noradId: tle.noradId,
          name: tle.name,
        },
      })

      const trailEntities = Array.from(
        { length: MAX_VISIBLE_TRAIL_SEGMENTS },
        (_, index) => {
          const trailEntity = dataSource.entities.add({
            id: `satellite-trail-${tle.noradId}-${index}`,
            show: false,
            polyline: {
              positions: [],
              width: 1,
              material: style.trailColor,
              arcType: Cesium.ArcType.NONE,
            },
            properties: {
              layerType: 'satellite',
              noradId: tle.noradId,
              name: tle.name,
            },
          })
          return trailEntity
        },
      )

      const entry = {
        tle,
        pointEntity,
        trailEntities,
        trailPositions: [],
        currentPosition,
        currentVelocityKmS,
        currentCartesian: toCartesian(currentPosition),
        isVisible: false,
      }

      satelliteEntries.push(entry)
      entityLookup.set(pointEntity.id, entry)
      trailEntities.forEach((trailEntity) => {
        entityLookup.set(trailEntity.id, entry)
      })
    })

    loaded = true
    dataSource.show = visible
    updateVisibilityFromCamera()
  }

  const ensureLoaded = async (forceReload = false) => {
    if (destroyed) {
      return
    }

    if (!loadPromise && (forceReload || !loaded)) {
      loadPromise = rebuildEntities().finally(() => {
        loadPromise = null
      })
    }

    if (loadPromise) {
      await loadPromise
    }
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
      startTimers()
      requestRender()
    },

    hide() {
      visible = false
      stopTimers()
      clearCameraVisibilityTimeout()
      dataSource.show = false
      clearSelection()
      requestRender()
    },

    async setDisplayLimits({
      satelliteLimit: nextSatelliteLimit,
    }) {
      const parsedSatelliteLimit = Math.max(
        1,
        Number(nextSatelliteLimit) || DEFAULT_SATELLITE_LIMIT,
      )

      if (destroyed || parsedSatelliteLimit === activeMaxSatellites) {
        return
      }

      activeMaxSatellites = parsedSatelliteLimit
      loaded = false
      clearSelection()

      if (visible) {
        await ensureLoaded(true)
        startTimers()
        requestRender()
      }
    },

    handlePick(pickedObject) {
      if (!Cesium.defined(pickedObject) || !Cesium.defined(pickedObject.id)) {
        return false
      }

      const metadata = getEntityMetadata(pickedObject.id)

      if (!metadata || metadata.layerType !== 'satellite') {
        return false
      }

      const entry = entityLookup.get(pickedObject.id.id)

      if (!entry) {
        return false
      }

      selectedNoradId = metadata.noradId
      emitSelection(entry)
      updateTrails(getDisplayTime())
      lastTrailUpdateTimeMs = currentTimeMs
      updateVisibilityFromCamera()
      return true
    },

    setTime(nextTimeMs) {
      const parsedTimeMs = Number(nextTimeMs)

      if (!Number.isFinite(parsedTimeMs)) {
        return
      }

      const timeJumpMs = Math.abs(parsedTimeMs - currentTimeMs)
      currentTimeMs = parsedTimeMs

      if (!visible || destroyed || !loaded) {
        return
      }

      updatePositions(getDisplayTime())
      lastPositionUpdateTimeMs = currentTimeMs

      if (timeJumpMs >= TRAIL_UPDATE_MS) {
        updateTrails(getDisplayTime())
        lastTrailUpdateTimeMs = currentTimeMs
        return
      }

      requestRender()
    },

    clearSelection,

    destroy() {
      destroyed = true
      stopTimers()
      clearCameraVisibilityTimeout()
      clearSelection()
      entityLookup.clear()
      satelliteEntries.length = 0

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
