import axios from 'axios'

// ShipInfo.net proxy - enriches ship data with details, port calls, and track history.
// The shipinfo.net API is free and doesn't require authentication.

const SHIPINFO_BASE = 'https://shipinfo.net/topos/api/vessel'
const SUMMARY_CACHE_TTL_MS = 5 * 60 * 1000
const PORTCALLS_CACHE_TTL_MS = 15 * 60 * 1000
const TRACK_CACHE_TTL_MS = 10 * 60 * 1000

const summaryCache = new Map()
const portCallsCache = new Map()
const trackCache = new Map()

function isCacheFresh(timestampMs, ttlMs) {
  return Date.now() - timestampMs < ttlMs
}

async function fetchWithTimeout(url, timeoutMs = 15_000) {
  return axios.get(url, {
    timeout: timeoutMs,
    headers: {
      'User-Agent': 'earth-app-ship-info-proxy',
    },
  })
}

export async function fetchShipSummary(mmsi) {
  if (!mmsi) {
    return null
  }

  const cacheKey = String(mmsi)
  const cached = summaryCache.get(cacheKey)

  if (cached && isCacheFresh(cached.timestampMs, SUMMARY_CACHE_TTL_MS)) {
    return cached.data
  }

  try {
    const response = await fetchWithTimeout(
      `${SHIPINFO_BASE}/summary?mmsi=${encodeURIComponent(mmsi)}`,
    )

    if (!response.data?.data?.ship) {
      return null
    }

    const result = response.data
    summaryCache.set(cacheKey, {
      data: result,
      timestampMs: Date.now(),
    })

    return result
  } catch (error) {
    console.error(`Unable to fetch ship summary for MMSI ${mmsi}.`, error)

    if (cached) {
      return cached.data
    }

    return null
  }
}

export async function fetchShipPortCalls(mmsi, days = 90, limit = 30) {
  if (!mmsi) {
    return null
  }

  const cacheKey = `${mmsi}::${days}::${limit}`
  const cached = portCallsCache.get(cacheKey)

  if (cached && isCacheFresh(cached.timestampMs, PORTCALLS_CACHE_TTL_MS)) {
    return cached.data
  }

  try {
    const response = await fetchWithTimeout(
      `${SHIPINFO_BASE}/portcalls?days=${days}&limit=${limit}&mmsi=${encodeURIComponent(mmsi)}`,
    )

    if (!response.data?.data) {
      return null
    }

    const result = response.data
    portCallsCache.set(cacheKey, {
      data: result,
      timestampMs: Date.now(),
    })

    return result
  } catch (error) {
    console.error(`Unable to fetch port calls for MMSI ${mmsi}.`, error)

    if (cached) {
      return cached.data
    }

    return null
  }
}

export async function fetchShipTrack(mmsi, days = 60, maxPoints = 3000) {
  if (!mmsi) {
    return null
  }

  const cacheKey = `${mmsi}::${days}::${maxPoints}`
  const cached = trackCache.get(cacheKey)

  if (cached && isCacheFresh(cached.timestampMs, TRACK_CACHE_TTL_MS)) {
    return cached.data
  }

  try {
    const response = await fetchWithTimeout(
      `${SHIPINFO_BASE}/track?days=${days}&max_points=${maxPoints}&mmsi=${encodeURIComponent(mmsi)}`,
    )

    if (!response.data?.data) {
      return null
    }

    const result = response.data
    trackCache.set(cacheKey, {
      data: result,
      timestampMs: Date.now(),
    })

    return result
  } catch (error) {
    console.error(`Unable to fetch track for MMSI ${mmsi}.`, error)

    if (cached) {
      return cached.data
    }

    return null
  }
}

// Periodic cache cleanup
setInterval(() => {
  const now = Date.now()

  for (const [key, entry] of summaryCache) {
    if (now - entry.timestampMs > SUMMARY_CACHE_TTL_MS * 2) {
      summaryCache.delete(key)
    }
  }

  for (const [key, entry] of portCallsCache) {
    if (now - entry.timestampMs > PORTCALLS_CACHE_TTL_MS * 2) {
      portCallsCache.delete(key)
    }
  }

  for (const [key, entry] of trackCache) {
    if (now - entry.timestampMs > TRACK_CACHE_TTL_MS * 2) {
      trackCache.delete(key)
    }
  }
}, 5 * 60 * 1000)