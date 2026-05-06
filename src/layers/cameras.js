import * as Cesium from 'cesium'
import { fetchCameraViewport } from '../services/cameras.js'
import { getHorizonAwareViewRectangleDegrees } from '../utils/cameraViewport.js'
import { formatBboxParam, getBboxSpans, padBbox, snapBbox } from '../utils/geo.js'

const CAMERA_DATA_SOURCE_NAME = 'cameras'
const CAMERA_REFRESH_MS = 220
const CAMERA_DEFAULT_FOCUS = {
  minimumZoomDistance: 24,
  defaultZoomDistance: 160,
  maximumZoomDistance: 18_000,
  defaultPitchDegrees: -30,
}
const CAMERA_HORIZON_MAX_CAMERA_HEIGHT_METERS = 250_000
const CAMERA_HORIZON_MIN_PITCH_DEGREES = -30
const CAMERA_HORIZON_MAX_PITCH_DEGREES = 24
const CAMERA_HORIZON_MIN_HALF_DISTANCE_METERS = 600
const CAMERA_HORIZON_MAX_HALF_DISTANCE_METERS = 50_000
const CAMERA_HORIZON_HEIGHT_MULTIPLIER = 2.6
const CLUSTER_SCALE_BY_DISTANCE = new Cesium.NearFarScalar(
  80_000,
  1,
  15_000_000,
  0.55,
)
const CAMERA_SCALE_BY_DISTANCE = new Cesium.NearFarScalar(
  10_000,
  1,
  2_000_000,
  0.5,
)
const CAMERA_POINT_COLOR = Cesium.Color.fromCssColorString('#22d3ee')
const CAMERA_SELECTED_POINT_COLOR = Cesium.Color.WHITE
const CAMERA_OUTLINE_COLOR = Cesium.Color.fromCssColorString('#0f172a')
const CLUSTER_LEVEL_COLORS = {
  country: Cesium.Color.fromCssColorString('#f59e0b'),
  state: Cesium.Color.fromCssColorString('#38bdf8'),
  city: Cesium.Color.fromCssColorString('#10b981'),
}
const CLUSTER_PIXEL_SIZES = {
  country: 36,
  state: 30,
  city: 24,
}
const CAMERA_HEIGHT_LEVELS = {
  country: 2_500_000,
  state: 375_000,
  city: 90_000,
}

function requestRender(viewer) {
  try {
    if (!viewer.isDestroyed()) {
      viewer.scene.requestRender()
    }
  } catch {
    // No-op during teardown.
  }
}

function getViewRectangleDegrees(viewer) {
  return getHorizonAwareViewRectangleDegrees(viewer, {
    maximumCameraHeightMeters: CAMERA_HORIZON_MAX_CAMERA_HEIGHT_METERS,
    minimumPitchDegrees: CAMERA_HORIZON_MIN_PITCH_DEGREES,
    maximumPitchDegrees: CAMERA_HORIZON_MAX_PITCH_DEGREES,
    minLocalHalfDistanceMeters: CAMERA_HORIZON_MIN_HALF_DISTANCE_METERS,
    maxLocalHalfDistanceMeters: CAMERA_HORIZON_MAX_HALF_DISTANCE_METERS,
    localDistanceHeightMultiplier: CAMERA_HORIZON_HEIGHT_MULTIPLIER,
  })
}

function getViewportPrecisionDegrees(viewRectangle) {
  const spans = getBboxSpans(viewRectangle)

  if (spans.latitudeSpan >= 14 || spans.longitudeSpan >= 18) {
    return 0.35
  }

  if (spans.latitudeSpan >= 2 || spans.longitudeSpan >= 3) {
    return 0.08
  }

  if (spans.latitudeSpan >= 0.35 || spans.longitudeSpan >= 0.5) {
    return 0.018
  }

  return 0.006
}

function buildFetchViewport(viewer) {
  const viewRectangle = getViewRectangleDegrees(viewer)

  if (!viewRectangle) {
    return {
      west: -180,
      south: -90,
      east: 180,
      north: 90,
    }
  }

  const paddedViewport = padBbox(viewRectangle, {
    latitudeRatio: 0.08,
    longitudeRatio: 0.08,
    minLatitudePad: 0.01,
    minLongitudePad: 0.01,
    maxLatitudePad: 4,
    maxLongitudePad: 6,
  })

  return snapBbox(
    paddedViewport,
    getViewportPrecisionDegrees(viewRectangle),
  )
}

function getCameraHeightMeters(viewer) {
  const cameraHeightMeters = Number(viewer?.camera?.positionCartographic?.height)
  return Number.isFinite(cameraHeightMeters)
    ? Math.max(0, cameraHeightMeters)
    : 0
}

function getCameraHeightBucket(heightMeters) {
  const normalizedHeightMeters = Math.max(0, Number(heightMeters) || 0)

  if (normalizedHeightMeters >= CAMERA_HEIGHT_LEVELS.country) {
    return 'country'
  }

  if (normalizedHeightMeters >= CAMERA_HEIGHT_LEVELS.state) {
    return 'state'
  }

  if (normalizedHeightMeters >= CAMERA_HEIGHT_LEVELS.city) {
    return 'city'
  }

  return 'camera'
}

function formatCompactCount(value) {
  const count = Math.max(0, Number(value) || 0)

  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1)}M`
  }

  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1)}k`
  }

  return `${count}`
}

function getEntityMetadata(entity) {
  if (!entity?.properties) {
    return null
  }

  const now = Cesium.JulianDate.now()
  const layerType = entity.properties.layerType?.getValue(now)
  const entryId = entity.properties.entryId?.getValue(now)
  const entryType = entity.properties.entryType?.getValue(now)

  if (!layerType || !entryId || !entryType) {
    return null
  }

  return {
    layerType,
    entryId,
    entryType,
  }
}

function getLocationLabel(camera) {
  const locationParts = [camera.city, camera.state, camera.country].filter(Boolean)
  return locationParts.length > 0 ? locationParts.join(', ') : 'Unknown location'
}

function buildSelection(camera) {
  return {
    type: 'camera',
    id: camera.id,
    cameraCode: camera.cameraCode,
    name: camera.name,
    city: camera.city,
    state: camera.state,
    country: camera.country,
    locationLabel: getLocationLabel(camera),
    lat: camera.lat,
    lon: camera.lon,
    feedUrl: camera.feedUrl,
    feedType: camera.feedType,
    updateRateMs: camera.updateRateMs,
    source: camera.source,
    direction: camera.direction,
    lastChecked: camera.lastChecked,
    category: camera.category,
    lastSeenBySource: camera.lastSeenBySource,
    trafficSlug: camera.trafficSlug,
    forceDirect: camera.forceDirect,
    description: camera.description,
    timezone: camera.timezone,
    feedLastModified: camera.feedLastModified,
    viewCount: camera.viewCount,
    shareCount: camera.shareCount,
  }
}

function updateCameraVisualState(entry, isSelected) {
  if (!entry?.entity?.point) {
    return
  }

  entry.entity.point.pixelSize = isSelected ? 11 : 8
  entry.entity.point.color = isSelected
    ? CAMERA_SELECTED_POINT_COLOR
    : CAMERA_POINT_COLOR
  entry.entity.point.outlineWidth = isSelected ? 3 : 1.5
  entry.entity.point.outlineColor = isSelected
    ? Cesium.Color.fromCssColorString('#67e8f9')
    : CAMERA_OUTLINE_COLOR
}

function createClusterEntity(dataSource, item) {
  const clusterColor =
    CLUSTER_LEVEL_COLORS[item.level] ?? CLUSTER_LEVEL_COLORS.country
  const pixelSize =
    CLUSTER_PIXEL_SIZES[item.level] ?? CLUSTER_PIXEL_SIZES.country

  return dataSource.entities.add({
    id: item.id,
    position: Cesium.Cartesian3.fromDegrees(item.lon, item.lat, 0),
    point: {
      pixelSize,
      color: clusterColor.withAlpha(0.92),
      outlineColor: CAMERA_OUTLINE_COLOR,
      outlineWidth: 2,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      scaleByDistance: CLUSTER_SCALE_BY_DISTANCE,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: formatCompactCount(item.count),
      font: '600 13px sans-serif',
      fillColor: Cesium.Color.WHITE,
      outlineColor: CAMERA_OUTLINE_COLOR,
      outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: Cesium.VerticalOrigin.CENTER,
      horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
      scaleByDistance: CLUSTER_SCALE_BY_DISTANCE,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    properties: {
      layerType: 'camera-overlay',
      entryId: item.id,
      entryType: item.type,
    },
  })
}

function createCameraEntity(dataSource, item) {
  return dataSource.entities.add({
    id: item.id,
    position: Cesium.Cartesian3.fromDegrees(item.lon, item.lat, 0),
    point: {
      pixelSize: 8,
      color: CAMERA_POINT_COLOR,
      outlineColor: CAMERA_OUTLINE_COLOR,
      outlineWidth: 1.5,
      heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
      scaleByDistance: CAMERA_SCALE_BY_DISTANCE,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    properties: {
      layerType: 'camera-overlay',
      entryId: item.id,
      entryType: item.type,
    },
  })
}

function buildZoomHeightForCluster(viewer, cluster) {
  const currentHeightMeters = getCameraHeightMeters(viewer)

  return Math.min(
    Math.max(2_500, currentHeightMeters * 0.45),
    Math.max(2_500, Number(cluster?.nextZoomHeightMeters) || 32_000),
  )
}

export function createCameraLayer({
  viewer,
  onSelectionChange,
} = {}) {
  const dataSource = new Cesium.CustomDataSource(CAMERA_DATA_SOURCE_NAME)
  const entries = new Map()

  let attached = false
  let destroyed = false
  let visible = false
  let selectedCameraId = null
  let removeCameraMoveEndListener = null
  let cameraRefreshTimeoutId = null
  let syncGeneration = 0
  let loadPromise = null
  let lastViewportRequestKey = ''
  let lastViewportPayload = null

  const emitSelection = (entry) => {
    onSelectionChange?.(
      entry?.item?.type === 'camera' ? buildSelection(entry.item) : null,
    )
  }

  function clearCameraRefreshTimeout() {
    if (cameraRefreshTimeoutId !== null) {
      window.clearTimeout(cameraRefreshTimeoutId)
      cameraRefreshTimeoutId = null
    }
  }

  function clearEntries() {
    dataSource.entities.removeAll()
    entries.clear()
  }

  function attachEntry(item) {
    const entity = item.type === 'cluster'
      ? createClusterEntity(dataSource, item)
      : createCameraEntity(dataSource, item)
    const entry = {
      item,
      entity,
    }

    entries.set(item.id, entry)
    return entry
  }

  function reconcileViewportPayload(payload) {
    const nextSelectedCameraId = selectedCameraId

    clearEntries()
    payload.items.forEach((item) => {
      attachEntry(item)
    })

    if (nextSelectedCameraId) {
      const selectedEntry = entries.get(nextSelectedCameraId)

      if (selectedEntry?.item?.type === 'camera') {
        selectedCameraId = nextSelectedCameraId
        updateCameraVisualState(selectedEntry, true)
        emitSelection(selectedEntry)
      } else {
        selectedCameraId = null
        emitSelection(null)
      }
    }

    dataSource.show = visible
    requestRender(viewer)
  }

  async function ensureDataSource() {
    if (attached || destroyed) {
      dataSource.show = visible
      return
    }

    attached = true
    await viewer.dataSources.add(dataSource)
  }

  async function syncViewport() {
    if (!visible || destroyed) {
      return
    }

    const generation = ++syncGeneration
    const bbox = buildFetchViewport(viewer)
    const heightMeters = getCameraHeightMeters(viewer)
    const requestKey = `${formatBboxParam(bbox)}|${getCameraHeightBucket(heightMeters)}`

    if (requestKey === lastViewportRequestKey && lastViewportPayload) {
      if (entries.size > 0) {
        dataSource.show = visible
        requestRender(viewer)
        return
      }

      reconcileViewportPayload(lastViewportPayload)
      return
    }

    const payload = await fetchCameraViewport({
      bbox,
      heightMeters,
    })

    if (destroyed || !visible || generation !== syncGeneration) {
      return
    }

    lastViewportRequestKey = requestKey
    lastViewportPayload = payload
    reconcileViewportPayload(payload)
  }

  function scheduleViewportSync() {
    clearCameraRefreshTimeout()
    cameraRefreshTimeoutId = window.setTimeout(() => {
      cameraRefreshTimeoutId = null
      syncViewport().catch((error) => {
        console.error('Unable to sync the camera overlay.', error)
      })
    }, CAMERA_REFRESH_MS)
  }

  function attachCameraListener() {
    if (removeCameraMoveEndListener || destroyed) {
      return
    }

    removeCameraMoveEndListener = viewer.camera.moveEnd.addEventListener(() => {
      scheduleViewportSync()
    })
  }

  function detachCameraListener() {
    if (!removeCameraMoveEndListener) {
      return
    }

    removeCameraMoveEndListener()
    removeCameraMoveEndListener = null
  }

  function clearSelection() {
    if (selectedCameraId) {
      const selectedEntry = entries.get(selectedCameraId)

      if (selectedEntry) {
        updateCameraVisualState(selectedEntry, false)
      }
    }

    selectedCameraId = null
    emitSelection(null)
    requestRender(viewer)
  }

  function zoomToCluster(entry) {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        entry.item.lon,
        entry.item.lat,
        buildZoomHeightForCluster(viewer, entry.item),
      ),
      duration: 0.9,
    })
  }

  return {
    async show() {
      if (destroyed) {
        return
      }

      visible = true

      if (!loadPromise) {
        loadPromise = ensureDataSource().finally(() => {
          loadPromise = null
        })
      }

      await loadPromise
      attachCameraListener()
      await syncViewport()
    },

    hide() {
      visible = false
      syncGeneration += 1
      clearCameraRefreshTimeout()
      detachCameraListener()
      clearSelection()
      dataSource.show = false
      requestRender(viewer)
    },

    clearSelection,

    handlePick(pickedObject) {
      const metadata = getEntityMetadata(pickedObject?.id)

      if (metadata?.layerType !== 'camera-overlay') {
        return false
      }

      const entry = entries.get(metadata.entryId)

      if (!entry) {
        return false
      }

      if (entry.item.type === 'cluster') {
        clearSelection()
        zoomToCluster(entry)
        return true
      }

      if (selectedCameraId && selectedCameraId !== entry.item.id) {
        const previousEntry = entries.get(selectedCameraId)

        if (previousEntry) {
          updateCameraVisualState(previousEntry, false)
        }
      }

      selectedCameraId = entry.item.id
      updateCameraVisualState(entry, true)
      emitSelection(entry)
      requestRender(viewer)
      return true
    },

    getFocusTarget() {
      if (!selectedCameraId) {
        return null
      }

      const selectedEntry = entries.get(selectedCameraId)

      if (!selectedEntry?.entity) {
        return null
      }

      return {
        entity: selectedEntry.entity,
        focus: CAMERA_DEFAULT_FOCUS,
      }
    },

    destroy() {
      destroyed = true
      this.hide()
      clearEntries()
      lastViewportRequestKey = ''
      lastViewportPayload = null

      if (attached && !viewer.isDestroyed()) {
        viewer.dataSources.remove(dataSource, true)
      }

      attached = false
    },
  }
}
