import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import axios from 'axios'
import { createAircraftDataClient } from './aircraft.js'
import { createCameraDataClient } from './cameras.js'
import { createLocationSearchClient } from './geocoding.js'
import { createPolymarketClient } from './polymarket.js'
import { createShipDataClient } from './ships.js'
import {
  formatBboxParam,
  normalizeBbox,
  parseBboxParam,
} from '../src/utils/geo.js'

import { fetchGpsJammingData, getCachedTimestampMs } from './gpsJamming.js'
import { fetchShipSummary, fetchShipPortCalls, fetchShipTrack } from './shipInfo.js'

// This server is the credential and normalization boundary for the whole app.
// The browser should only talk to these local `/api/*` routes, never directly
// to ADS-B Exchange, OpenSky, Open-Meteo, or AISStream.
function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return
  }

  const envContents = fs.readFileSync(filePath, 'utf8')

  envContents.split(/\r?\n/).forEach((line) => {
    const trimmedLine = line.trim()

    if (!trimmedLine || trimmedLine.startsWith('#')) {
      return
    }

    const separatorIndex = trimmedLine.indexOf('=')

    if (separatorIndex === -1) {
      return
    }

    const key = trimmedLine.slice(0, separatorIndex).trim()
    const rawValue = trimmedLine.slice(separatorIndex + 1).trim()
    const value = rawValue.replace(/^['"]|['"]$/g, '')

    if (key && process.env[key] === undefined) {
      process.env[key] = value
    }
  })
}

const serverDirectory = path.dirname(fileURLToPath(import.meta.url))
loadEnvFile(path.resolve(serverDirectory, '../.env.local'))

const PORT = Number(process.env.SATELLITE_API_PORT || 3001)
const TLE_SOURCE_URL =
  'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle'
const AIRCRAFT_CACHE_TTL_MS = 10_000
const LOCATION_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000
const PREDICTIONS_CACHE_TTL_MS = 60_000
const SHIPS_CACHE_TTL_MS = 60_000
const TLE_CACHE_TTL_MS = 30 * 60 * 1000

const aircraftDataClient = createAircraftDataClient({
  env: process.env,
  httpClient: axios,
})
const cameraDataClient = createCameraDataClient()
const locationSearchClient = createLocationSearchClient({
  httpClient: axios,
})
const polymarketClient = createPolymarketClient({
  httpClient: axios,
})
const shipDataClient = createShipDataClient({
  env: process.env,
  httpClient: axios,
})

let cachedAircraftPayload = null
let cachedAircraftPayloadTimestampMs = 0
let pendingAircraftRequest = null
let cachedPredictionPayload = null
let cachedPredictionPayloadTimestampMs = 0
let pendingPredictionRequest = null
const cachedLocationSearchPayloads = new Map()
const pendingLocationSearchRequests = new Map()
const cachedShipPayloads = new Map()
const pendingShipRequests = new Map()
let cachedTlePayload = null
let cachedTlePayloadTimestampMs = 0
let pendingTleRequest = null


function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

function sendCachedAircraft(response, payload, { stale = false } = {}) {
  response.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': stale
      ? 'public, max-age=2, stale-while-revalidate=10'
      : 'public, max-age=5',
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(
    JSON.stringify({
      ...payload,
      stale,
    }),
  )
}

async function fetchAircraftPayload() {
  const nowMs = Date.now()

  if (
    cachedAircraftPayload &&
    nowMs - cachedAircraftPayloadTimestampMs < AIRCRAFT_CACHE_TTL_MS
  ) {
    return cachedAircraftPayload
  }

  if (!pendingAircraftRequest) {
    pendingAircraftRequest = aircraftDataClient
      .fetchAircraftPayload()
      .then((payload) => {
        cachedAircraftPayload = payload
        cachedAircraftPayloadTimestampMs = Date.now()
        return payload
      })
      .finally(() => {
        pendingAircraftRequest = null
      })
  }

  return pendingAircraftRequest
}

async function fetchPredictionPayload() {
  const nowMs = Date.now()

  if (
    cachedPredictionPayload &&
    nowMs - cachedPredictionPayloadTimestampMs < PREDICTIONS_CACHE_TTL_MS
  ) {
    return cachedPredictionPayload
  }

  if (!pendingPredictionRequest) {
    pendingPredictionRequest = polymarketClient
      .fetchPredictionMarkets()
      .then((payload) => {
        cachedPredictionPayload = payload
        cachedPredictionPayloadTimestampMs = Date.now()
        return payload
      })
      .finally(() => {
        pendingPredictionRequest = null
      })
  }

  return pendingPredictionRequest
}

async function fetchLocationSearchPayload(query, limit = 6) {
  const normalizedQuery = String(query || '').trim()
  const normalizedLimit = Math.max(1, Math.min(8, Number(limit) || 6))

  if (!normalizedQuery) {
    return {
      source: 'nominatim',
      query: '',
      results: [],
    }
  }

  const cacheKey = `${normalizedQuery.toLowerCase()}::${normalizedLimit}`
  const nowMs = Date.now()
  const cachedEntry = cachedLocationSearchPayloads.get(cacheKey)

  if (
    cachedEntry &&
    nowMs - cachedEntry.timestampMs < LOCATION_SEARCH_CACHE_TTL_MS
  ) {
    return cachedEntry.payload
  }

  if (!pendingLocationSearchRequests.has(cacheKey)) {
    pendingLocationSearchRequests.set(
      cacheKey,
      locationSearchClient.searchLocations({
        query: normalizedQuery,
        limit: normalizedLimit,
      })
        .then((payload) => {
          cachedLocationSearchPayloads.set(cacheKey, {
            timestampMs: Date.now(),
            payload,
          })
          return payload
        })
        .finally(() => {
          pendingLocationSearchRequests.delete(cacheKey)
        }),
    )
  }

  return pendingLocationSearchRequests.get(cacheKey)
}

async function fetchTlePayload() {
  const nowMs = Date.now()

  if (cachedTlePayload && nowMs - cachedTlePayloadTimestampMs < TLE_CACHE_TTL_MS) {
    return cachedTlePayload
  }

  if (!pendingTleRequest) {
    pendingTleRequest = axios
      .get(TLE_SOURCE_URL, {
        responseType: 'text',
        timeout: 15_000,
        headers: {
          'User-Agent': 'earth-app-satellite-proxy',
        },
      })
      .then((satelliteResponse) => {
        cachedTlePayload = satelliteResponse.data
        cachedTlePayloadTimestampMs = Date.now()
        return cachedTlePayload
      })
      .finally(() => {
        pendingTleRequest = null
      })
  }

  return pendingTleRequest
}

function parseRequestBbox(url) {
  const bboxParam = url.searchParams.get('bbox')

  if (bboxParam) {
    return parseBboxParam(bboxParam)
  }

  return normalizeBbox({
    west: Number(url.searchParams.get('west')),
    east: Number(url.searchParams.get('east')),
    south: Number(url.searchParams.get('south')),
    north: Number(url.searchParams.get('north')),
  })
}

function parseRequestHeightMeters(url) {
  const heightParam = url.searchParams.get('height')
  const parsedHeightMeters = Number(heightParam)

  return Number.isFinite(parsedHeightMeters)
    ? Math.max(0, parsedHeightMeters)
    : Number.POSITIVE_INFINITY
}

async function fetchShipPayload(url) {
  const bbox = parseRequestBbox(url)

  // AISStream is already long-lived and viewport-aware on the backend, so
  // streaming ship responses should come straight from the live client instead
  // of going through the older bbox-keyed HTTP cache path.
  if (shipDataClient.isStreamingProvider?.()) {
    return shipDataClient.fetchShips({ bbox })
  }

  const bboxKey = bbox ? formatBboxParam(bbox) : 'auto'
  const nowMs = Date.now()
  const cachedEntry = cachedShipPayloads.get(bboxKey)

  if (cachedEntry && nowMs - cachedEntry.timestampMs < SHIPS_CACHE_TTL_MS) {
    return cachedEntry.payload
  }

  if (!pendingShipRequests.has(bboxKey)) {
    pendingShipRequests.set(
      bboxKey,
      shipDataClient.fetchShips({ bbox }).then((payload) => {
        cachedShipPayloads.set(bboxKey, {
          timestampMs: Date.now(),
          payload,
        })

        return payload
      })
        .finally(() => {
          pendingShipRequests.delete(bboxKey)
        }),
    )
  }

  return pendingShipRequests.get(bboxKey)
}



async function handleRequest(request, response) {
  if (!request.url) {
    sendJson(response, 400, { error: 'Missing request URL.' })
    return
  }

  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    response.end()
    return
  }

  const url = new URL(request.url, `http://${request.headers.host}`)

  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { ok: true })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/satellites/tle') {
    try {
      const tlePayload = await fetchTlePayload()

      response.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'public, max-age=900',
        'Content-Type': 'text/plain; charset=utf-8',
      })
      response.end(tlePayload)
      return
    } catch (error) {
      console.error('Unable to fetch TLE data from CelesTrak.', error)
      sendJson(response, 502, {
        error: 'Unable to fetch TLE data from CelesTrak.',
      })
      return
    }
  }

  

  if (
    request.method === 'GET' &&
    (url.pathname === '/api/cameras' || url.pathname === '/api/cameras/viewport')
  ) {
    try {
      const payload = await cameraDataClient.fetchCameraViewport({
        bbox: parseRequestBbox(url),
        heightMeters: parseRequestHeightMeters(url),
      })

      sendJson(response, 200, payload)
      return
    } catch (error) {
      console.error('Unable to fetch viewport camera data.', error)
      sendJson(response, 502, {
        error: 'Unable to fetch viewport camera data.',
      })
      return
    }
  }

  if (request.method === 'GET' && url.pathname === '/api/aircraft/states') {
    try {
      const payload = await fetchAircraftPayload()
      sendCachedAircraft(response, payload)
      return
    } catch (error) {
      console.error(
        `Unable to fetch aircraft data from ${aircraftDataClient.resolveProvider()}.`,
        error,
      )

      if (cachedAircraftPayload) {
        sendCachedAircraft(response, cachedAircraftPayload, {
          stale: true,
        })
        return
      }

      sendJson(response, 502, {
        error: `Unable to fetch aircraft data from ${aircraftDataClient.resolveProvider()}.`,
      })
      return
    }
  }

  if (
    request.method === 'GET' &&
    (
      url.pathname === '/api/predictions' ||
      url.pathname === '/api/predictions/markets'
    )
  ) {
    try {
      const payload = await fetchPredictionPayload()
      sendJson(response, 200, payload)
      return
    } catch (error) {
      polymarketClient.logFailure(error)

      if (cachedPredictionPayload) {
        sendJson(response, 200, cachedPredictionPayload)
        return
      }

      sendJson(response, 502, {
        error: 'Unable to fetch prediction markets from Polymarket.',
      })
      return
    }
  }

  if (
    request.method === 'GET' &&
    (
      url.pathname === '/api/locations/search' ||
      url.pathname === '/api/geocode/search'
    )
  ) {
    try {
      const query = url.searchParams.get('q') || ''
      const payload = await fetchLocationSearchPayload(
        query,
        url.searchParams.get('limit'),
      )
      sendJson(response, 200, payload)
      return
    } catch (error) {
      locationSearchClient.logFailure(error)
      sendJson(response, 502, {
        error: 'Unable to search locations.',
      })
      return
    }
  }

  if (
    request.method === 'GET' &&
    url.pathname === '/api/gps-jamming'
  ) {
    try {
      const timestampMs = Number(url.searchParams.get('timestamp')) || Date.now()
      const payload = await fetchGpsJammingData(timestampMs)
      sendJson(response, 200, {
        source: 'gpsjam.org',
        data: payload,
        timestamp: getCachedTimestampMs(),
      })
      return
    } catch (error) {
      console.error('Unable to fetch GPS jamming data.', error)
      sendJson(response, 502, {
        error: 'Unable to fetch GPS jamming data.',
      })
      return
    }
  }

  if (
    request.method === 'GET' &&
    (url.pathname === '/api/ships' || url.pathname === '/api/ships/states')
  ) {
    try {
      const payload = await fetchShipPayload(url)
      sendJson(response, 200, payload)
      return
    } catch (error) {
      console.error(
        `Unable to fetch ship data from ${shipDataClient.resolveProvider()}.`,
        error,
      )
      sendJson(response, 502, {
        error: `Unable to fetch ship data from ${shipDataClient.resolveProvider()}.`,
      })
      return
    }
  }

  if (
    request.method === 'GET' &&
    url.pathname === '/api/ships/info'
  ) {
    try {
      const mmsi = url.searchParams.get('mmsi')

      if (!mmsi) {
        sendJson(response, 400, { error: 'Missing mmsi parameter.' })
        return
      }

      const [summary, portCalls, track] = await Promise.all([
        fetchShipSummary(mmsi),
        fetchShipPortCalls(mmsi),
        fetchShipTrack(mmsi, 60, 3000),
      ])

      sendJson(response, 200, {
        summary: summary?.data ?? null,
        portCalls: portCalls?.data ?? null,
        track: track?.data ?? null,
      })
      return
    } catch (error) {
      console.error('Unable to fetch ship info.', error)
      sendJson(response, 502, {
        error: 'Unable to fetch ship info.',
      })
      return
    }
  }

  if (
    request.method === 'GET' &&
    url.pathname === '/api/ships/track'
  ) {
    try {
      const mmsi = url.searchParams.get('mmsi')
      const days = Number(url.searchParams.get('days')) || 7
      const maxPoints = Number(url.searchParams.get('max_points')) || 3000

      if (!mmsi) {
        sendJson(response, 400, { error: 'Missing mmsi parameter.' })
        return
      }

      const track = await fetchShipTrack(mmsi, days, maxPoints)

      sendJson(response, 200, {
        track: track?.data ?? null,
      })
      return
    } catch (error) {
      console.error('Unable to fetch ship track.', error)
      sendJson(response, 502, {
        error: 'Unable to fetch ship track.',
      })
      return
    }
  }

  sendJson(response, 404, { error: 'Not found.' })
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    console.error('Unhandled geospatial proxy error.', error)
    sendJson(response, 500, { error: 'Internal server error.' })
  })
})

server.listen(PORT, () => {
  console.log(`Geospatial proxy listening on http://127.0.0.1:${PORT}`)
})

const shutdown = () => {
  shipDataClient.destroy?.()
  server.close(() => {
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
