import axios from 'axios'

export const LOCATION_SEARCH_ENDPOINT = '/api/locations/search'
const NOMINATIM_SEARCH_ENDPOINT = 'https://nominatim.openstreetmap.org/search'

function toTrimmedString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() || fallback : fallback
}

function toFiniteNumber(value, fallback = null) {
  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) ? parsedValue : fallback
}

function normalizeBoundingBox(value) {
  if (Array.isArray(value) && value.length >= 4) {
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

  if (!value || typeof value !== 'object') {
    return null
  }

  const south = toFiniteNumber(value.south)
  const north = toFiniteNumber(value.north)
  const west = toFiniteNumber(value.west)
  const east = toFiniteNumber(value.east)

  if (
    !Number.isFinite(south) ||
    !Number.isFinite(north) ||
    !Number.isFinite(west) ||
    !Number.isFinite(east)
  ) {
    return null
  }

  return {
    south,
    north,
    west,
    east,
  }
}

function buildLocationTitle(result = {}) {
  const explicitTitle = toTrimmedString(result.title)

  if (explicitTitle) {
    return explicitTitle
  }

  const explicitName = toTrimmedString(result.name)

  if (explicitName) {
    return explicitName
  }

  const displayName = toTrimmedString(
    result.displayName,
    toTrimmedString(result.display_name),
  )

  if (!displayName) {
    return 'Unnamed place'
  }

  return displayName.split(',')[0]?.trim() || displayName
}

function normalizeLocationSearchResult(result = {}) {
  const lat = toFiniteNumber(result.lat)
  const lon = toFiniteNumber(result.lon)

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null
  }

  const displayName = toTrimmedString(
    result.displayName,
    toTrimmedString(result.display_name),
  )
  const title = buildLocationTitle(result)
  const subtitle = toTrimmedString(
    result.subtitle,
    displayName.startsWith(title)
      ? displayName.slice(title.length).replace(/^,\s*/, '')
      : displayName,
  )

  return {
    id: toTrimmedString(
      result.id,
      toTrimmedString(
        result.place_id?.toString?.(),
        toTrimmedString(result.osm_id?.toString?.(), `${lat}:${lon}`),
      ),
    ),
    title,
    subtitle,
    displayName: displayName || title,
    lat,
    lon,
    bbox: normalizeBoundingBox(result.bbox ?? result.boundingbox),
  }
}

async function fetchLocationsFromProxy(query, limit) {
  const response = await axios.get(LOCATION_SEARCH_ENDPOINT, {
    params: {
      q: query,
      limit,
    },
    timeout: 10_000,
  })

  return Array.isArray(response.data?.results)
    ? response.data.results.map(normalizeLocationSearchResult).filter(Boolean)
    : []
}

async function fetchLocationsFromNominatim(query, limit) {
  const response = await axios.get(NOMINATIM_SEARCH_ENDPOINT, {
    params: {
      q: query,
      format: 'jsonv2',
      addressdetails: 1,
      limit,
    },
    timeout: 10_000,
  })

  return Array.isArray(response.data)
    ? response.data.map(normalizeLocationSearchResult).filter(Boolean)
    : []
}

export async function searchLocations(query, { limit = 6 } = {}) {
  const normalizedQuery = toTrimmedString(query)
  const normalizedLimit = Math.max(1, Math.min(8, Number(limit) || 6))

  if (!normalizedQuery) {
    return []
  }

  try {
    return await fetchLocationsFromProxy(normalizedQuery, normalizedLimit)
  } catch (error) {
    console.warn(
      'Location proxy unavailable, falling back to direct Nominatim search.',
      error,
    )
  }

  return fetchLocationsFromNominatim(normalizedQuery, normalizedLimit)
}
