import axios from 'axios'
import * as Cesium from 'cesium'

// ShipInfo.net browser service - fetches enriched ship data from the local proxy.

const SHIP_INFO_ENDPOINT = '/api/ships/info'
const SHIP_TRACK_ENDPOINT = '/api/ships/track'
const INFO_CACHE_TTL_MS = 5 * 60 * 1000
const TRACK_CACHE_TTL_MS = 10 * 60 * 1000

const infoCache = new Map()
const trackCache = new Map()

export async function fetchShipInfo(mmsi) {
  if (!mmsi) {
    return null
  }

  const cacheKey = String(mmsi)
  const cached = infoCache.get(cacheKey)

  if (cached && Date.now() - cached.timestampMs < INFO_CACHE_TTL_MS) {
    return cached.data
  }

  try {
    const response = await axios.get(SHIP_INFO_ENDPOINT, {
      params: { mmsi },
      timeout: 20_000,
    })

    const data = response.data
    infoCache.set(cacheKey, {
      data,
      timestampMs: Date.now(),
    })

    return data
  } catch (error) {
    console.error(`Unable to fetch ship info for MMSI ${mmsi}.`, error)

    if (cached) {
      return cached.data
    }

    return null
  }
}

export async function fetchShipTrack(mmsi, days = 7, maxPoints = 3000) {
  if (!mmsi) {
    return null
  }

  const cacheKey = `${mmsi}::${days}::${maxPoints}`
  const cached = trackCache.get(cacheKey)

  if (cached && Date.now() - cached.timestampMs < TRACK_CACHE_TTL_MS) {
    return cached.data
  }

  try {
    const response = await axios.get(SHIP_TRACK_ENDPOINT, {
      params: { mmsi, days, max_points: maxPoints },
      timeout: 20_000,
    })

    const data = response.data
    trackCache.set(cacheKey, {
      data,
      timestampMs: Date.now(),
    })

    return data
  } catch (error) {
    console.error(`Unable to fetch ship track for MMSI ${mmsi}.`, error)

    if (cached) {
      return cached.data
    }

    return null
  }
}

export function clearShipInfoCache(mmsi) {
  if (mmsi) {
    infoCache.delete(String(mmsi))
  } else {
    infoCache.clear()
  }
}

export function clearTrackCache(mmsi) {
  if (mmsi) {
    const prefix = `${mmsi}::`
    for (const key of trackCache.keys()) {
      if (key.startsWith(prefix)) {
        trackCache.delete(key)
      }
    }
  } else {
    trackCache.clear()
  }
}

// Track history line utilities
export function buildTrackPositions(trackData) {
  if (!trackData?.length) {
    return []
  }

  return trackData
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
    .map((point) => {
      return Cesium.Cartesian3.fromDegrees(point.lng, point.lat, 0)
    })
}

export function getTrackColor(shipState) {
  const typeColors = {
    cargo: [56, 189, 248],
    tanker: [251, 113, 133],
    passenger: [192, 132, 252],
    fishing: [52, 211, 153],
    tug: [245, 158, 11],
    pilot: [253, 224, 71],
    military: [239, 68, 68],
  }

  const type = shipState?.type || 'other'
  const [r, g, b] = typeColors[type] || [148, 163, 184]

  return {
    red: r / 255,
    green: g / 255,
    blue: b / 255,
    alpha: 0.7,
  }
}
