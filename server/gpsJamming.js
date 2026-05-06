import { parse as parseCsv } from 'csv-parse/sync'

// GPS jamming data from gpsjam.org.
// The data is keyed by H3 hexagon indices (resolution 4).

const GPS_JAMMING_SOURCE_URL = 'https://gpsjam.org/data'
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

// The gpsjam.org site publishes daily CSVs. The URL format is:
// https://gpsjam.org/data/YYYY-MM-DD-h3_4.csv
// The file for "today" may not exist yet, so we try backwards by day
// for up to 3 days before giving up.

// These are mutated by the server's route handler for response metadata.
let cachedPayload = null
let cachedTimestampMs = 0
let pendingRequest = null

export function getCachedTimestampMs() {
  return cachedTimestampMs
}

function isSameDay(dateA, dateB) {
  return (
    dateA.getFullYear() === dateB.getFullYear() &&
    dateA.getMonth() === dateB.getMonth() &&
    dateA.getDate() === dateB.getDate()
  )
}

function formatDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function buildUrl(timestampMs) {
  const base = process.env.GPS_JAMMING_URL || GPS_JAMMING_SOURCE_URL
  const date = timestampMs ? new Date(timestampMs) : new Date()
  const formattedDate = formatDate(date)
  return `${base}/${formattedDate}-h3_4.csv`
}

function normalizeCsvRow(row) {
  const countGood = parseInt(row.count_good_aircraft, 10) || 0
  const countBad = parseInt(row.count_bad_aircraft, 10) || 0
  const total = countGood + countBad
  const jammingRatio = total > 0 ? countBad / total : 0

  return {
    hex: row.hex,
    countGoodAircraft: countGood,
    countBadAircraft: countBad,
    totalAircraft: total,
    jammingRatio,
  }
}

function parseCsvResponse(text) {
  const records = parseCsv(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  })

  return records.map(normalizeCsvRow)
}

async function tryFetchDate(baseDate, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    const tryDate = new Date(baseDate)
    tryDate.setDate(tryDate.getDate() - i)
    const url = buildUrl(tryDate.getTime())

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'earth-app-gps-jamming-proxy',
        },
        signal: AbortSignal.timeout(15_000),
      })

      if (response.ok) {
        const text = await response.text()
        return {
          data: parseCsvResponse(text),
          date: tryDate,
        }
      }
    } catch {
      // Try next date
    }
  }

  return null
}

async function fetchGpsJammingData(timestampMs) {
  const nowMs = Date.now()

  // Reuse cache if it's from the same day and still fresh
  if (
    cachedPayload &&
    cachedTimestampMs &&
    nowMs - cachedTimestampMs < CACHE_TTL_MS &&
    isSameDay(new Date(cachedTimestampMs), new Date(nowMs))
  ) {
    return cachedPayload
  }

  if (!pendingRequest) {
    pendingRequest = tryFetchDate(timestampMs || nowMs)
      .then((result) => {
        if (!result) {
          throw new Error('Unable to fetch GPS jamming data for any recent date')
        }

        cachedPayload = result.data
        cachedTimestampMs = Date.now()
        return result.data
      })
      .catch((error) => {
        console.error('Unable to fetch GPS jamming data.', error)
        if (cachedPayload) {
          return cachedPayload
        }
        throw error
      })
      .finally(() => {
        pendingRequest = null
      })
  }

  return pendingRequest
}

export { fetchGpsJammingData, buildUrl }