import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  clampLatitude,
  getBboxSpans,
  isCoordinateWithinBbox,
  normalizeBbox,
  snapBbox,
  wrapLongitude,
} from '../src/utils/geo.js'

const DEFAULT_CAMERA_DATASET_SOURCE = 'local-cameras'
const CAMERA_INDEX_CELL_SIZE_DEGREES = 1
const DEFAULT_VIEW_BBOX = {
  west: -180,
  south: -90,
  east: 180,
  north: 90,
}
const MAX_VIEW_CACHE_ENTRIES = 48

export const CAMERA_VIEW_LEVELS = {
  country: {
    nextZoomHeightMeters: 1_100_000,
    bboxPrecisionDegrees: 0.6,
  },
  state: {
    nextZoomHeightMeters: 180_000,
    bboxPrecisionDegrees: 0.12,
  },
  city: {
    nextZoomHeightMeters: 32_000,
    bboxPrecisionDegrees: 0.035,
  },
  camera: {
    nextZoomHeightMeters: 10_000,
    bboxPrecisionDegrees: 0.01,
  },
}

function defaultDatasetPath() {
  const serverDirectory = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(serverDirectory, '../cameras/cameras.json')
}

function toTrimmedString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() || fallback : fallback
}

function toFiniteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') {
    return fallback
  }

  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) ? parsedValue : fallback
}

function toBooleanFlag(value) {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'number') {
    return value !== 0
  }

  const normalizedValue = toTrimmedString(value).toLowerCase()

  if (!normalizedValue) {
    return false
  }

  return normalizedValue !== '0' && normalizedValue !== 'false'
}

function buildStateLabel(camera) {
  return camera.state || camera.country
}

function buildCityLabel(camera) {
  return camera.city || camera.state || camera.country
}

function buildCountryKey(country) {
  return country || 'Unknown'
}

function getLatitudeCellCount(cellSizeDegrees = CAMERA_INDEX_CELL_SIZE_DEGREES) {
  return Math.max(1, Math.ceil(180 / Math.max(0.1, Number(cellSizeDegrees) || 1)))
}

function getLongitudeCellCount(cellSizeDegrees = CAMERA_INDEX_CELL_SIZE_DEGREES) {
  return Math.max(1, Math.ceil(360 / Math.max(0.1, Number(cellSizeDegrees) || 1)))
}

function getLatitudeCellIndex(lat, cellSizeDegrees = CAMERA_INDEX_CELL_SIZE_DEGREES) {
  const latitudeCellCount = getLatitudeCellCount(cellSizeDegrees)
  const normalizedLatitude = clampLatitude(lat)

  return Math.min(
    latitudeCellCount - 1,
    Math.max(0, Math.floor((normalizedLatitude + 90) / cellSizeDegrees)),
  )
}

function getLongitudeCellIndex(
  lon,
  cellSizeDegrees = CAMERA_INDEX_CELL_SIZE_DEGREES,
) {
  const longitudeCellCount = getLongitudeCellCount(cellSizeDegrees)
  const normalizedLongitude = wrapLongitude(lon)

  return Math.min(
    longitudeCellCount - 1,
    Math.max(0, Math.floor((normalizedLongitude + 180) / cellSizeDegrees)),
  )
}

function getSpatialBucketKey(latCellIndex, lonCellIndex) {
  return `${latCellIndex}:${lonCellIndex}`
}

function getLongitudeCellRanges(
  bbox,
  cellSizeDegrees = CAMERA_INDEX_CELL_SIZE_DEGREES,
) {
  const normalizedBbox = normalizeBbox(bbox)
  const longitudeCellCount = getLongitudeCellCount(cellSizeDegrees)

  if (!normalizedBbox) {
    return []
  }

  const toRange = (west, east) => ({
    start:
      west <= -180
        ? 0
        : getLongitudeCellIndex(west, cellSizeDegrees),
    end:
      east >= 180
        ? longitudeCellCount - 1
        : getLongitudeCellIndex(east, cellSizeDegrees),
  })

  if (normalizedBbox.west <= normalizedBbox.east) {
    return [toRange(normalizedBbox.west, normalizedBbox.east)]
  }

  return [
    toRange(normalizedBbox.west, 180),
    toRange(-180, normalizedBbox.east),
  ]
}

export function normalizeCameraRecord(record) {
  const id = toTrimmedString(record?.id)
  const lat = toFiniteNumber(record?.lat)
  const lon = toFiniteNumber(record?.lng)
  const feedUrl = toTrimmedString(record?.feed_url)
  const isActive = toBooleanFlag(record?.active)
  const isIgnored = toBooleanFlag(record?.ignored)
  const duplicateOf = toTrimmedString(record?.duplicate_of)

  if (!id || lat === null || lon === null || !feedUrl || !isActive) {
    return null
  }

  if (isIgnored || duplicateOf) {
    return null
  }

  const country = toTrimmedString(record?.country, 'Unknown')
  const state = toTrimmedString(record?.state)
  const city = toTrimmedString(record?.city)

  return {
    id,
    cameraCode: toFiniteNumber(record?.camera_code),
    name: toTrimmedString(record?.name, id),
    city,
    state,
    country,
    lat: clampLatitude(lat),
    lon: wrapLongitude(lon),
    feedUrl,
    feedType: toTrimmedString(record?.feed_type, 'image').toLowerCase(),
    updateRateMs: Math.max(0, toFiniteNumber(record?.update_rate, 0)),
    source: toTrimmedString(record?.source, 'unknown'),
    direction: toTrimmedString(record?.direction),
    lastChecked: toTrimmedString(record?.last_checked),
    category: toTrimmedString(record?.category, 'traffic'),
    lastSeenBySource: toTrimmedString(record?.last_seen_by_source),
    trafficSlug: toTrimmedString(record?.traffic_slug),
    forceDirect: toBooleanFlag(record?.force_direct),
    description: toTrimmedString(record?.description),
    timezone: toTrimmedString(record?.timezone),
    feedLastModified: toTrimmedString(record?.feed_last_modified),
    viewCount: Math.max(0, toFiniteNumber(record?.view_count, 0)),
    shareCount: Math.max(0, toFiniteNumber(record?.share_count, 0)),
    active: true,
    countryKey: buildCountryKey(country),
    stateKey: `${buildCountryKey(country)}|${state || '(no-state)'}`,
    cityKey: `${buildCountryKey(country)}|${state || '(no-state)'}|${city || '(no-city)'}`,
  }
}

export function resolveCameraViewportLevel({
  bbox = DEFAULT_VIEW_BBOX,
  heightMeters = Number.POSITIVE_INFINITY,
} = {}) {
  const normalizedBbox = normalizeBbox(bbox) || DEFAULT_VIEW_BBOX
  const spans = getBboxSpans(normalizedBbox)
  const normalizedHeightMeters = Number(heightMeters)

  if (
    (
      Number.isFinite(normalizedHeightMeters) &&
      normalizedHeightMeters >= 2_500_000
    ) ||
    spans.latitudeSpan >= 30 ||
    spans.longitudeSpan >= 45
  ) {
    return 'country'
  }

  if (
    (
      Number.isFinite(normalizedHeightMeters) &&
      normalizedHeightMeters >= 375_000
    ) ||
    spans.latitudeSpan >= 3.2 ||
    spans.longitudeSpan >= 5
  ) {
    return 'state'
  }

  if (
    (
      Number.isFinite(normalizedHeightMeters) &&
      normalizedHeightMeters >= 90_000
    ) ||
    spans.latitudeSpan >= 0.45 ||
    spans.longitudeSpan >= 0.7
  ) {
    return 'city'
  }

  return 'camera'
}

function getClusterKey(camera, level) {
  switch (level) {
    case 'country':
      return camera.countryKey
    case 'state':
      return camera.stateKey
    case 'city':
      return camera.cityKey
    default:
      return camera.id
  }
}

function getClusterLabel(camera, level) {
  switch (level) {
    case 'country':
      return camera.country
    case 'state':
      return buildStateLabel(camera)
    case 'city':
      return buildCityLabel(camera)
    default:
      return camera.name
  }
}

function getClusterContextLabel(camera, level) {
  switch (level) {
    case 'country':
      return ''
    case 'state':
      return camera.country
    case 'city': {
      const parentState = buildStateLabel(camera)
      return parentState === camera.country
        ? camera.country
        : `${parentState}, ${camera.country}`
    }
    default:
      return ''
  }
}

function createClusterAccumulator(camera, level) {
  return {
    type: 'cluster',
    level,
    key: getClusterKey(camera, level),
    label: getClusterLabel(camera, level),
    contextLabel: getClusterContextLabel(camera, level),
    country: camera.country,
    state: camera.state,
    city: camera.city,
    count: 0,
    latitudeTotal: 0,
    longitudeSinTotal: 0,
    longitudeCosTotal: 0,
  }
}

function updateClusterAccumulator(accumulator, camera) {
  const longitudeRadians = (camera.lon * Math.PI) / 180

  accumulator.count += 1
  accumulator.latitudeTotal += camera.lat
  accumulator.longitudeSinTotal += Math.sin(longitudeRadians)
  accumulator.longitudeCosTotal += Math.cos(longitudeRadians)
}

function finalizeClusterAccumulator(accumulator) {
  const longitudeRadians = Math.atan2(
    accumulator.longitudeSinTotal,
    accumulator.longitudeCosTotal,
  )

  return {
    type: 'cluster',
    id: `camera-cluster-${accumulator.level}-${accumulator.key}`,
    level: accumulator.level,
    label: accumulator.label,
    contextLabel: accumulator.contextLabel,
    country: accumulator.country,
    state: accumulator.state,
    city: accumulator.city,
    count: accumulator.count,
    lat: accumulator.latitudeTotal / accumulator.count,
    lon: wrapLongitude((longitudeRadians * 180) / Math.PI),
    nextZoomHeightMeters:
      CAMERA_VIEW_LEVELS[accumulator.level]?.nextZoomHeightMeters ??
      CAMERA_VIEW_LEVELS.camera.nextZoomHeightMeters,
  }
}

function buildCameraViewportItem(camera) {
  return {
    type: 'camera',
    id: camera.id,
    cameraCode: camera.cameraCode,
    name: camera.name,
    city: camera.city,
    state: camera.state,
    country: camera.country,
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

function touchViewCacheEntry(viewCache, cacheKey) {
  const cachedEntry = viewCache.get(cacheKey)

  if (!cachedEntry) {
    return null
  }

  viewCache.delete(cacheKey)
  viewCache.set(cacheKey, cachedEntry)
  return cachedEntry
}

function setViewCacheEntry(viewCache, cacheKey, payload) {
  viewCache.set(cacheKey, payload)

  while (viewCache.size > MAX_VIEW_CACHE_ENTRIES) {
    const oldestKey = viewCache.keys().next().value
    viewCache.delete(oldestKey)
  }
}

function buildViewCacheKey(bbox, level) {
  const precisionDegrees =
    CAMERA_VIEW_LEVELS[level]?.bboxPrecisionDegrees ??
    CAMERA_VIEW_LEVELS.country.bboxPrecisionDegrees
  const snappedBbox = snapBbox(bbox, precisionDegrees)

  return JSON.stringify({
    level,
    bbox: snappedBbox,
  })
}

export function buildCameraSpatialIndex(
  cameraCatalog,
  {
    cellSizeDegrees = CAMERA_INDEX_CELL_SIZE_DEGREES,
  } = {},
) {
  const normalizedCellSizeDegrees = Math.max(
    0.1,
    Number(cellSizeDegrees) || CAMERA_INDEX_CELL_SIZE_DEGREES,
  )
  const buckets = new Map()

  for (const camera of Array.isArray(cameraCatalog) ? cameraCatalog : []) {
    const latCellIndex = getLatitudeCellIndex(
      camera.lat,
      normalizedCellSizeDegrees,
    )
    const lonCellIndex = getLongitudeCellIndex(
      camera.lon,
      normalizedCellSizeDegrees,
    )
    const bucketKey = getSpatialBucketKey(latCellIndex, lonCellIndex)
    let bucket = buckets.get(bucketKey)

    if (!bucket) {
      bucket = []
      buckets.set(bucketKey, bucket)
    }

    bucket.push(camera)
  }

  return {
    cellSizeDegrees: normalizedCellSizeDegrees,
    latitudeCellCount: getLatitudeCellCount(normalizedCellSizeDegrees),
    longitudeCellCount: getLongitudeCellCount(normalizedCellSizeDegrees),
    buckets,
  }
}

export function filterCameraCatalogByViewport(
  cameraCatalog,
  spatialIndex,
  bbox = DEFAULT_VIEW_BBOX,
) {
  const normalizedBbox = normalizeBbox(bbox) || DEFAULT_VIEW_BBOX
  const spans = getBboxSpans(normalizedBbox)

  if (
    !spatialIndex?.buckets ||
    spans.latitudeSpan >= 179.5 ||
    spans.longitudeSpan >= 359.5
  ) {
    return Array.isArray(cameraCatalog) ? cameraCatalog : []
  }

  const candidates = []
  const latitudeStartIndex = getLatitudeCellIndex(
    normalizedBbox.south,
    spatialIndex.cellSizeDegrees,
  )
  const latitudeEndIndex = getLatitudeCellIndex(
    normalizedBbox.north,
    spatialIndex.cellSizeDegrees,
  )
  const longitudeRanges = getLongitudeCellRanges(
    normalizedBbox,
    spatialIndex.cellSizeDegrees,
  )

  for (
    let latitudeCellIndex = latitudeStartIndex;
    latitudeCellIndex <= latitudeEndIndex;
    latitudeCellIndex += 1
  ) {
    for (const longitudeRange of longitudeRanges) {
      for (
        let longitudeCellIndex = longitudeRange.start;
        longitudeCellIndex <= longitudeRange.end;
        longitudeCellIndex += 1
      ) {
        const bucket = spatialIndex.buckets.get(
          getSpatialBucketKey(latitudeCellIndex, longitudeCellIndex),
        )

        if (bucket?.length) {
          candidates.push(...bucket)
        }
      }
    }
  }

  return candidates
}

export function buildCameraViewportPayload(
  cameraCatalog,
  {
    bbox = DEFAULT_VIEW_BBOX,
    heightMeters = Number.POSITIVE_INFINITY,
    source = DEFAULT_CAMERA_DATASET_SOURCE,
    visibleCameraCatalog = cameraCatalog,
  } = {},
) {
  const normalizedBbox = normalizeBbox(bbox) || DEFAULT_VIEW_BBOX
  const level = resolveCameraViewportLevel({
    bbox: normalizedBbox,
    heightMeters,
  })
  const clusterAccumulators = new Map()
  const items = []
  let visibleCameraCount = 0

  for (const camera of visibleCameraCatalog) {
    if (!isCoordinateWithinBbox(camera.lat, camera.lon, normalizedBbox)) {
      continue
    }

    visibleCameraCount += 1

    if (level === 'camera') {
      items.push(buildCameraViewportItem(camera))
      continue
    }

    const clusterKey = getClusterKey(camera, level)
    let accumulator = clusterAccumulators.get(clusterKey)

    if (!accumulator) {
      accumulator = createClusterAccumulator(camera, level)
      clusterAccumulators.set(clusterKey, accumulator)
    }

    updateClusterAccumulator(accumulator, camera)
  }

  const normalizedItems =
    level === 'camera'
      ? items.sort((leftCamera, rightCamera) => {
          const leftCityLabel = buildCityLabel(leftCamera)
          const rightCityLabel = buildCityLabel(rightCamera)

          return (
            leftCityLabel.localeCompare(rightCityLabel) ||
            leftCamera.name.localeCompare(rightCamera.name)
          )
        })
      : [...clusterAccumulators.values()]
        .map(finalizeClusterAccumulator)
        .sort((leftCluster, rightCluster) => {
          return (
            rightCluster.count - leftCluster.count ||
            leftCluster.label.localeCompare(rightCluster.label)
          )
        })

  return {
    source,
    generatedAt: Date.now(),
    level,
    viewport: {
      bbox: normalizedBbox,
      heightMeters: Number.isFinite(Number(heightMeters))
        ? Number(heightMeters)
        : null,
    },
    totalCameraCount: cameraCatalog.length,
    visibleCameraCount,
    itemCount: normalizedItems.length,
    items: normalizedItems,
  }
}

export function createCameraDataClient({
  datasetPath = defaultDatasetPath(),
  logger = console,
} = {}) {
  const resolvedDatasetPath = path.resolve(datasetPath)
  const viewCache = new Map()

  let cameraCatalogState = null
  let pendingCameraCatalogLoad = null

  async function ensureCameraCatalog() {
    if (cameraCatalogState) {
      return cameraCatalogState
    }

    if (!pendingCameraCatalogLoad) {
      pendingCameraCatalogLoad = fs
        .readFile(resolvedDatasetPath, 'utf8')
        .then((rawCameraPayload) => JSON.parse(rawCameraPayload))
        .then((records) =>
          Array.isArray(records)
            ? records.map(normalizeCameraRecord).filter(Boolean)
            : [],
        )
        .then((normalizedCatalog) => {
          cameraCatalogState = {
            catalog: normalizedCatalog,
            spatialIndex: buildCameraSpatialIndex(normalizedCatalog),
          }
          logger.info?.(
            `Loaded ${normalizedCatalog.length.toLocaleString()} cameras from ${resolvedDatasetPath}.`,
          )
          return cameraCatalogState
        })
        .finally(() => {
          pendingCameraCatalogLoad = null
        })
    }

    return pendingCameraCatalogLoad
  }

  return {
    async fetchCameraViewport({
      bbox = DEFAULT_VIEW_BBOX,
      heightMeters = Number.POSITIVE_INFINITY,
    } = {}) {
      const normalizedBbox = normalizeBbox(bbox) || DEFAULT_VIEW_BBOX
      const level = resolveCameraViewportLevel({
        bbox: normalizedBbox,
        heightMeters,
      })
      const cacheKey = buildViewCacheKey(normalizedBbox, level)
      const cachedPayload = touchViewCacheEntry(viewCache, cacheKey)

      if (cachedPayload) {
        return cachedPayload
      }

      const cameraCatalog = await ensureCameraCatalog()
      const payload = buildCameraViewportPayload(cameraCatalog.catalog, {
        bbox: normalizedBbox,
        heightMeters,
        source: DEFAULT_CAMERA_DATASET_SOURCE,
        visibleCameraCatalog: filterCameraCatalogByViewport(
          cameraCatalog.catalog,
          cameraCatalog.spatialIndex,
          normalizedBbox,
        ),
      })

      setViewCacheEntry(viewCache, cacheKey, payload)
      return payload
    },
  }
}
