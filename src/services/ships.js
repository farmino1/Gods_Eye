import axios from 'axios'
import { formatBboxParam, wrapLongitude } from '../utils/geo.js'

const KNOTS_TO_METERS_PER_SECOND = 0.514444

export const SHIPS_ENDPOINT = '/api/ships/states'
export const SHIP_POLL_MS = 10_000

function toFiniteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') {
    return fallback
  }

  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) ? parsedValue : fallback
}

function toTrimmedString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() || fallback : fallback
}

function normalizeHeading(value) {
  const parsedValue = toFiniteNumber(value, 0)
  return ((parsedValue % 360) + 360) % 360
}

function interpolateAngle(startValue, endValue, progress) {
  const normalizedStart = normalizeHeading(startValue)
  const normalizedEnd = normalizeHeading(endValue)
  const delta = ((normalizedEnd - normalizedStart + 540) % 360) - 180

  return normalizeHeading(normalizedStart + delta * progress)
}

function interpolateLongitude(startValue, endValue, progress) {
  const normalizedStart = wrapLongitude(startValue)
  const normalizedEnd = wrapLongitude(endValue)
  const delta = ((normalizedEnd - normalizedStart + 540) % 360) - 180

  return wrapLongitude(normalizedStart + delta * progress)
}

function normalizeShipType(value) {
  const normalizedValue = toTrimmedString(value, 'other').toLowerCase()

  if (
    normalizedValue.includes('military') ||
    normalizedValue.includes('navy') ||
    normalizedValue.includes('naval') ||
    normalizedValue.includes('warship') ||
    normalizedValue.includes('coast guard') ||
    normalizedValue.includes('patrol') ||
    normalizedValue.includes('frigate') ||
    normalizedValue.includes('destroyer') ||
    normalizedValue.includes('corvette') ||
    normalizedValue.includes('submarine')
  ) {
    return 'military'
  }

  if (normalizedValue.includes('cargo')) {
    return 'cargo'
  }

  if (normalizedValue.includes('tanker')) {
    return 'tanker'
  }

  if (normalizedValue.includes('passenger')) {
    return 'passenger'
  }

  if (normalizedValue.includes('fishing')) {
    return 'fishing'
  }

  if (
    normalizedValue.includes('tug') ||
    normalizedValue.includes('tow')
  ) {
    return 'tug'
  }

  if (normalizedValue.includes('pilot')) {
    return 'pilot'
  }

  return 'other'
}

function normalizeImoNumber(value) {
  const cleanedValue = toTrimmedString(value)
  const stringMatch = cleanedValue.match(/(\d{7})/)

  if (stringMatch) {
    return stringMatch[1]
  }

  const numericValue = toFiniteNumber(value)

  if (numericValue === null || numericValue <= 0) {
    return ''
  }

  const digits = String(Math.trunc(numericValue))
  return /^\d{7}$/.test(digits) ? digits : ''
}

export function normalizeShipState(ship) {
  const id = toTrimmedString(ship?.id ?? ship?.mmsi)
  const lat = toFiniteNumber(ship?.lat)
  const lon = toFiniteNumber(ship?.lon)

  if (!id || lat === null || lon === null) {
    return null
  }

  const speedKnots = Math.max(0, toFiniteNumber(ship?.speedKnots, 0))
  const heading = normalizeHeading(
    ship?.headingDegrees ?? ship?.heading ?? ship?.courseDegrees ?? 0,
  )
  const course = normalizeHeading(
    ship?.courseDegrees ?? ship?.course ?? ship?.headingDegrees ?? 0,
  )
  const timestampMs = toFiniteNumber(
    ship?.lastSeenMs ?? ship?.timestampMs,
    Date.now(),
  )
  const type = normalizeShipType(ship?.type)
  const imo = normalizeImoNumber(ship?.imo)
  const lookupId = imo || toTrimmedString(ship?.mmsi, id)
  const isMilitary =
    typeof ship?.isMilitary === 'boolean'
      ? ship.isMilitary
      : type === 'military'

  return {
    id,
    mmsi: toTrimmedString(ship?.mmsi, id),
    lat,
    lon: wrapLongitude(lon),
    speedKnots,
    speedMS: speedKnots * KNOTS_TO_METERS_PER_SECOND,
    heading,
    course,
    type,
    name: toTrimmedString(ship?.name, `MMSI ${id}`),
    callsign: toTrimmedString(ship?.callsign, 'Unavailable'),
    destination: toTrimmedString(ship?.destination, 'Unavailable'),
    imo,
    isMilitary,
    moreInfoUrl: lookupId
      ? `https://shipinfo.net/vessels_map.php?imo=${encodeURIComponent(lookupId)}`
      : '',
    timestampMs,
  }
}

function sortShipsForDisplay(ships) {
  if (!Array.isArray(ships)) {
    return []
  }

  return [...ships].sort((leftShip, rightShip) => {
    if (leftShip.isMilitary !== rightShip.isMilitary) {
      return Number(rightShip.isMilitary) - Number(leftShip.isMilitary)
    }

    if (leftShip.speedKnots !== rightShip.speedKnots) {
      return rightShip.speedKnots - leftShip.speedKnots
    }

    return leftShip.id.localeCompare(rightShip.id)
  })
}

export function interpolateShipState(startShip, endShip, progress) {
  if (!startShip || !endShip || startShip.id !== endShip.id) {
    return null
  }

  const clampedProgress = Math.max(0, Math.min(1, Number(progress) || 0))

  return {
    ...endShip,
    lat: startShip.lat + (endShip.lat - startShip.lat) * clampedProgress,
    lon: interpolateLongitude(startShip.lon, endShip.lon, clampedProgress),
    speedKnots:
      startShip.speedKnots +
      (endShip.speedKnots - startShip.speedKnots) * clampedProgress,
    speedMS:
      startShip.speedMS +
      (endShip.speedMS - startShip.speedMS) * clampedProgress,
    heading: interpolateAngle(startShip.heading, endShip.heading, clampedProgress),
    course: interpolateAngle(startShip.course, endShip.course, clampedProgress),
    timestampMs:
      startShip.timestampMs +
      (endShip.timestampMs - startShip.timestampMs) * clampedProgress,
  }
}

function getShipCatalog(snapshot) {
  if (Array.isArray(snapshot?.catalog)) {
    return snapshot.catalog
  }

  if (Array.isArray(snapshot?.shipCatalog)) {
    return snapshot.shipCatalog
  }

  return []
}

export function interpolateShipCatalogSnapshots(
  beforeSnapshot,
  afterSnapshot,
  targetTimestampMs,
) {
  if (!beforeSnapshot && !afterSnapshot) {
    return []
  }

  if (!afterSnapshot || beforeSnapshot?.timestamp === afterSnapshot.timestamp) {
    return sortShipsForDisplay(getShipCatalog(beforeSnapshot))
  }

  if (!beforeSnapshot) {
    return sortShipsForDisplay(getShipCatalog(afterSnapshot))
  }

  const progress = Math.max(
    0,
    Math.min(
      1,
      (targetTimestampMs - beforeSnapshot.timestamp) /
        Math.max(1, afterSnapshot.timestamp - beforeSnapshot.timestamp),
    ),
  )
  const afterLookup = new Map(
    getShipCatalog(afterSnapshot).map((ship) => [ship.id, ship]),
  )
  const interpolatedShips = []
  const seenShipIds = new Set()

  getShipCatalog(beforeSnapshot).forEach((beforeShip) => {
    const afterShip = afterLookup.get(beforeShip.id)

    if (afterShip) {
      const interpolatedShip = interpolateShipState(
        beforeShip,
        afterShip,
        progress,
      )

      if (interpolatedShip) {
        interpolatedShips.push(interpolatedShip)
      }

      seenShipIds.add(beforeShip.id)
      return
    }

    if (progress < 0.5) {
      interpolatedShips.push(beforeShip)
    }
  })

  getShipCatalog(afterSnapshot).forEach((afterShip) => {
    if (seenShipIds.has(afterShip.id)) {
      return
    }

    if (progress >= 0.5) {
      interpolatedShips.push(afterShip)
    }
  })

  return sortShipsForDisplay(interpolatedShips)
}

export async function fetchShips({ bbox } = {}) {
  try {
    const response = await axios.get(SHIPS_ENDPOINT, {
      timeout: 20_000,
      params: {
        ...(bbox ? { bbox: formatBboxParam(bbox) } : {}),
      },
    })

    return {
      configured: Boolean(response.data?.configured),
      source: response.data?.source ?? 'unconfigured',
      timeMs: toFiniteNumber(response.data?.timeMs, Date.now()),
      ships: sortShipsForDisplay(
        Array.isArray(response.data?.ships)
          ? response.data.ships.map(normalizeShipState).filter(Boolean)
          : [],
      ),
    }
  } catch (error) {
    console.error('Unable to fetch ship data.', error)

    return {
      configured: false,
      source: 'unconfigured',
      timeMs: Date.now(),
      ships: [],
    }
  }
}
