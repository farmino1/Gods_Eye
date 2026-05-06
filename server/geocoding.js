import axios from 'axios'

const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search'

function toTrimmedString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() || fallback : fallback
}

function toFiniteNumber(value, fallback = null) {
  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) ? parsedValue : fallback
}

function normalizeBoundingBox(value) {
  if (!Array.isArray(value) || value.length < 4) {
    return null
  }

  const south = toFiniteNumber(value[0])
  const north = toFiniteNumber(value[1])
  const west = toFiniteNumber(value[2])
  const east = toFiniteNumber(value[3])

  if (
    !Number.isFinite(south) ||
    !Number.isFinite(north) ||
    !Number.isFinite(west) ||
    !Number.isFinite(east)
  ) {
    return null
  }

  return {
    south: Math.min(south, north),
    north: Math.max(south, north),
    west: Math.min(west, east),
    east: Math.max(west, east),
  }
}

function buildLocationTitle(result) {
  const explicitName = toTrimmedString(result?.name)

  if (explicitName) {
    return explicitName
  }

  const displayName = toTrimmedString(result?.display_name)

  if (!displayName) {
    return 'Unnamed place'
  }

  return displayName.split(',')[0]?.trim() || displayName
}

export function normalizeLocationSearchResult(result = {}) {
  const lat = toFiniteNumber(result?.lat)
  const lon = toFiniteNumber(result?.lon)

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null
  }

  const displayName = toTrimmedString(result?.display_name)
  const title = buildLocationTitle(result)
  const subtitle = displayName.startsWith(title)
    ? displayName.slice(title.length).replace(/^,\s*/, '')
    : displayName

  return {
    id: toTrimmedString(
      result?.place_id?.toString?.(),
      toTrimmedString(result?.osm_id?.toString?.(), displayName || title),
    ),
    title,
    subtitle,
    displayName: displayName || title,
    lat,
    lon,
    bbox: normalizeBoundingBox(result?.boundingbox),
  }
}

export function createLocationSearchClient({
  httpClient = axios,
  logger = console,
} = {}) {
  return {
    async searchLocations({
      query,
      limit = 6,
    } = {}) {
      const normalizedQuery = toTrimmedString(query)

      if (!normalizedQuery) {
        return {
          source: 'nominatim',
          query: '',
          results: [],
        }
      }

      const response = await httpClient.get(NOMINATIM_SEARCH_URL, {
        params: {
          q: normalizedQuery,
          format: 'jsonv2',
          addressdetails: 1,
          limit: Math.max(1, Math.min(8, Number(limit) || 6)),
        },
        timeout: 10_000,
        headers: {
          'User-Agent': 'earth-app-location-search',
          Accept: 'application/json',
        },
      })

      return {
        source: 'nominatim',
        query: normalizedQuery,
        results: Array.isArray(response.data)
          ? response.data
            .map(normalizeLocationSearchResult)
            .filter(Boolean)
          : [],
      }
    },

    logFailure(error) {
      logger.error?.('Unable to search locations.', error)
    },
  }
}
