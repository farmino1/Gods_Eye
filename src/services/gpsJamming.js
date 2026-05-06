import axios from 'axios'

// GPS jamming data service - fetches and normalizes jamming data from the proxy.
// The raw data uses H3 hexagon indices (resolution 4) and aircraft signal counts.

const GPS_JAMMING_CACHE_TTL_MS = 5 * 60 * 1000

let cachedPayload = null
let cachedTimestampMs = 0

export async function fetchGpsJammingData(timestampMs = Date.now()) {
  const nowMs = Date.now()

  if (
    cachedPayload &&
    nowMs - cachedTimestampMs < GPS_JAMMING_CACHE_TTL_MS
  ) {
    return cachedPayload
  }

  try {
    const response = await axios.get('/api/gps-jamming', {
      params: { timestamp: timestampMs },
      timeout: 20_000,
    })

    cachedPayload = response.data
    cachedTimestampMs = nowMs
    return response.data
  } catch (error) {
    console.error('Unable to fetch GPS jamming data from proxy.', error)

    if (cachedPayload) {
      return cachedPayload
    }

    return {
      source: 'gpsjam.org',
      data: [],
      timestamp: 0,
      error: error.message,
    }
  }
}

/**
 * Color scale for jamming ratio visualization.
 * 0.0 = green (no jamming), 1.0 = red (severe jamming)
 */
export function getJammingColor(jammingRatio) {
  const clampedRatio = Math.max(0, Math.min(1, jammingRatio))

  // Multi-stop gradient: green -> yellow -> orange -> red
  if (clampedRatio < 0.25) {
    const t = clampedRatio / 0.25
    return {
      red: Math.round(34 + (255 - 34) * t),
      green: Math.round(197 + (255 - 197) * t),
      blue: Math.round(94 + (0 - 94) * t),
      alpha: 0.6,
    }
  } else if (clampedRatio < 0.5) {
    const t = (clampedRatio - 0.25) / 0.25
    return {
      red: 255,
      green: Math.round(255 - (255 - 165) * t),
      blue: 0,
      alpha: 0.65,
    }
  } else if (clampedRatio < 0.75) {
    const t = (clampedRatio - 0.5) / 0.25
    return {
      red: 255,
      green: Math.round(165 - (165 - 0) * t),
      blue: 0,
      alpha: 0.7,
    }
  } else {
    const t = (clampedRatio - 0.75) / 0.25
    return {
      red: Math.round(255 - (255 - 200) * t),
      green: 0,
      blue: 0,
      alpha: 0.8,
    }
  }
}

export function clearJammingCache() {
  cachedPayload = null
  cachedTimestampMs = 0
}