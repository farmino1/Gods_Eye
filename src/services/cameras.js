import axios from 'axios'
import { formatBboxParam } from '../utils/geo.js'

export const CAMERAS_ENDPOINT = '/api/cameras'

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

function normalizeCameraItem(item) {
  const id = toTrimmedString(item?.id)
  const lat = toFiniteNumber(item?.lat)
  const lon = toFiniteNumber(item?.lon)

  if (!id || lat === null || lon === null) {
    return null
  }

  return {
    type: 'camera',
    id,
    cameraCode: toFiniteNumber(item?.cameraCode),
    name: toTrimmedString(item?.name, id),
    city: toTrimmedString(item?.city),
    state: toTrimmedString(item?.state),
    country: toTrimmedString(item?.country, 'Unknown'),
    lat,
    lon,
    feedUrl: toTrimmedString(item?.feedUrl),
    feedType: toTrimmedString(item?.feedType, 'image').toLowerCase(),
    updateRateMs: Math.max(0, toFiniteNumber(item?.updateRateMs, 0)),
    source: toTrimmedString(item?.source, 'unknown'),
    direction: toTrimmedString(item?.direction),
    lastChecked: toTrimmedString(item?.lastChecked),
    category: toTrimmedString(item?.category, 'traffic'),
    lastSeenBySource: toTrimmedString(item?.lastSeenBySource),
    trafficSlug: toTrimmedString(item?.trafficSlug),
    forceDirect: Boolean(item?.forceDirect),
    description: toTrimmedString(item?.description),
    timezone: toTrimmedString(item?.timezone),
    feedLastModified: toTrimmedString(item?.feedLastModified),
    viewCount: Math.max(0, toFiniteNumber(item?.viewCount, 0)),
    shareCount: Math.max(0, toFiniteNumber(item?.shareCount, 0)),
  }
}

function normalizeClusterItem(item) {
  const id = toTrimmedString(item?.id)
  const lat = toFiniteNumber(item?.lat)
  const lon = toFiniteNumber(item?.lon)

  if (!id || lat === null || lon === null) {
    return null
  }

  return {
    type: 'cluster',
    id,
    level: toTrimmedString(item?.level, 'country'),
    label: toTrimmedString(item?.label, id),
    contextLabel: toTrimmedString(item?.contextLabel),
    country: toTrimmedString(item?.country, 'Unknown'),
    state: toTrimmedString(item?.state),
    city: toTrimmedString(item?.city),
    count: Math.max(1, toFiniteNumber(item?.count, 1)),
    lat,
    lon,
    nextZoomHeightMeters: Math.max(
      1_000,
      toFiniteNumber(item?.nextZoomHeightMeters, 32_000),
    ),
  }
}

export async function fetchCameraViewport({
  bbox,
  heightMeters,
} = {}) {
  const response = await axios.get(CAMERAS_ENDPOINT, {
    timeout: 30_000,
    params: {
      bbox: formatBboxParam(bbox),
      height: Math.max(0, Number(heightMeters) || 0),
    },
  })

  return {
    source: response.data?.source ?? 'local-cameras',
    generatedAt: Math.max(
      0,
      toFiniteNumber(response.data?.generatedAt, Date.now()),
    ),
    level: toTrimmedString(response.data?.level, 'country'),
    totalCameraCount: Math.max(
      0,
      toFiniteNumber(response.data?.totalCameraCount, 0),
    ),
    visibleCameraCount: Math.max(
      0,
      toFiniteNumber(response.data?.visibleCameraCount, 0),
    ),
    itemCount: Math.max(0, toFiniteNumber(response.data?.itemCount, 0)),
    items: Array.isArray(response.data?.items)
      ? response.data.items
        .map((item) =>
          item?.type === 'cluster'
            ? normalizeClusterItem(item)
            : normalizeCameraItem(item),
        )
        .filter(Boolean)
      : [],
  }
}
