import axios from 'axios'

export const AIRCRAFT_STATES_ENDPOINT = '/api/aircraft/states'
export const DEFAULT_AIRCRAFT_LIMIT = 200

const MILITARY_CALLSIGN_PATTERNS = [
  /^RCH/i,
  /^RRR/i,
  /^CFC/i,
  /^CNV/i,
  /^NAVY/i,
  /^SPAR/i,
  /^SAM/i,
  /^ASCOT/i,
  /^DUKE/i,
  /^HKY/i,
  /^QID/i,
  /^LAGR/i,
  /^TUAF/i,
  /^BAF/i,
  /^FNY/i,
  /^GAF/i,
  /^NAF/i,
  /^ASY/i,
  /^CEF/i,
  /^FORTE/i,
  /^SABRE/i,
]

const AIRCRAFT_STATE_INDEX = {
  icao24: 0,
  callsign: 1,
  originCountry: 2,
  lastContact: 4,
  lon: 5,
  lat: 6,
  baroAltitude: 7,
  onGround: 8,
  velocity: 9,
  heading: 10,
  verticalRate: 11,
  geoAltitude: 13,
  isMilitary: 14,
}

function toTrimmedString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() || fallback : fallback
}

function toFiniteNumber(value, fallback = null) {
  return Number.isFinite(value) ? value : fallback
}

function normalizeHeadingDegrees(value) {
  if (!Number.isFinite(value)) {
    return 0
  }

  return ((value % 360) + 360) % 360
}

function interpolateAngleDegrees(start, end, progress) {
  const normalizedStart = normalizeHeadingDegrees(start)
  const normalizedEnd = normalizeHeadingDegrees(end)
  const delta = ((normalizedEnd - normalizedStart + 540) % 360) - 180

  return normalizeHeadingDegrees(normalizedStart + delta * progress)
}

function isMilitaryAircraftCallsign(callsign) {
  if (!callsign) {
    return false
  }

  return MILITARY_CALLSIGN_PATTERNS.some((pattern) =>
    pattern.test(callsign),
  )
}

function compareAircraftPriority(leftAircraft, rightAircraft) {
  if (leftAircraft.onGround !== rightAircraft.onGround) {
    return Number(leftAircraft.onGround) - Number(rightAircraft.onGround)
  }

  if (leftAircraft.lastContact !== rightAircraft.lastContact) {
    return (rightAircraft.lastContact ?? 0) - (leftAircraft.lastContact ?? 0)
  }

  if (leftAircraft.altitude !== rightAircraft.altitude) {
    return rightAircraft.altitude - leftAircraft.altitude
  }

  if (leftAircraft.velocity !== rightAircraft.velocity) {
    return rightAircraft.velocity - leftAircraft.velocity
  }

  return leftAircraft.icao24.localeCompare(rightAircraft.icao24)
}

export function sortAircraftForDisplay(aircraft) {
  if (!Array.isArray(aircraft)) {
    return []
  }

  return [...aircraft].sort(compareAircraftPriority)
}

export function normalizeAircraftState(stateRow) {
  if (!Array.isArray(stateRow)) {
    return null
  }

  const icao24 = toTrimmedString(
    stateRow[AIRCRAFT_STATE_INDEX.icao24],
  ).toLowerCase()
  const callsign = toTrimmedString(
    stateRow[AIRCRAFT_STATE_INDEX.callsign],
    'Unknown',
  )
  const lat = toFiniteNumber(stateRow[AIRCRAFT_STATE_INDEX.lat])
  const lon = toFiniteNumber(stateRow[AIRCRAFT_STATE_INDEX.lon])

  if (!icao24 || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null
  }

  const geoAltitude = toFiniteNumber(stateRow[AIRCRAFT_STATE_INDEX.geoAltitude])
  const baroAltitude = toFiniteNumber(stateRow[AIRCRAFT_STATE_INDEX.baroAltitude])

  return {
    icao24,
    callsign,
    originCountry: toTrimmedString(
      stateRow[AIRCRAFT_STATE_INDEX.originCountry],
      'Unknown',
    ),
    lat,
    lon,
    altitude: geoAltitude ?? baroAltitude ?? 0,
    velocity: toFiniteNumber(stateRow[AIRCRAFT_STATE_INDEX.velocity], 0),
    heading: normalizeHeadingDegrees(
      stateRow[AIRCRAFT_STATE_INDEX.heading],
    ),
    verticalRate: toFiniteNumber(
      stateRow[AIRCRAFT_STATE_INDEX.verticalRate],
      0,
    ),
    onGround: Boolean(stateRow[AIRCRAFT_STATE_INDEX.onGround]),
    lastContact: toFiniteNumber(
      stateRow[AIRCRAFT_STATE_INDEX.lastContact],
      null,
    ),
    isMilitary:
      typeof stateRow[AIRCRAFT_STATE_INDEX.isMilitary] === 'boolean'
        ? stateRow[AIRCRAFT_STATE_INDEX.isMilitary]
        : isMilitaryAircraftCallsign(callsign),
  }
}

export function interpolateAircraftState(
  startAircraft,
  endAircraft,
  progress,
) {
  if (!startAircraft || !endAircraft || startAircraft.icao24 !== endAircraft.icao24) {
    return null
  }

  const clampedProgress = Math.max(0, Math.min(1, Number(progress) || 0))

  return {
    ...endAircraft,
    callsign: endAircraft.callsign || startAircraft.callsign,
    originCountry: endAircraft.originCountry || startAircraft.originCountry,
    lat:
      startAircraft.lat + (endAircraft.lat - startAircraft.lat) * clampedProgress,
    lon: interpolateAngleDegrees(
      startAircraft.lon,
      endAircraft.lon,
      clampedProgress,
    ),
    altitude:
      startAircraft.altitude +
      (endAircraft.altitude - startAircraft.altitude) * clampedProgress,
    velocity:
      startAircraft.velocity +
      (endAircraft.velocity - startAircraft.velocity) * clampedProgress,
    heading: interpolateAngleDegrees(
      startAircraft.heading,
      endAircraft.heading,
      clampedProgress,
    ),
    verticalRate:
      startAircraft.verticalRate +
      (endAircraft.verticalRate - startAircraft.verticalRate) * clampedProgress,
    onGround:
      clampedProgress < 0.5 ? startAircraft.onGround : endAircraft.onGround,
    lastContact:
      clampedProgress < 0.5 ? startAircraft.lastContact : endAircraft.lastContact,
    isMilitary: startAircraft.isMilitary || endAircraft.isMilitary,
  }
}

export function interpolateAircraftCatalogSnapshots(
  beforeSnapshot,
  afterSnapshot,
  targetTimestampMs,
) {
  const getAircraftCatalog = (snapshot) =>
    Array.isArray(snapshot?.catalog)
      ? snapshot.catalog
      : Array.isArray(snapshot?.aircraftCatalog)
        ? snapshot.aircraftCatalog
        : []

  if (!beforeSnapshot && !afterSnapshot) {
    return []
  }

  if (!afterSnapshot || beforeSnapshot?.timestamp === afterSnapshot.timestamp) {
    return sortAircraftForDisplay(getAircraftCatalog(beforeSnapshot))
  }

  if (!beforeSnapshot) {
    return sortAircraftForDisplay(getAircraftCatalog(afterSnapshot))
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
    getAircraftCatalog(afterSnapshot).map((aircraft) => [aircraft.icao24, aircraft]),
  )
  const interpolatedCatalog = []
  const seenIcao24 = new Set()

  getAircraftCatalog(beforeSnapshot).forEach((beforeAircraft) => {
    const afterAircraft = afterLookup.get(beforeAircraft.icao24)

    if (afterAircraft) {
      const interpolatedAircraft = interpolateAircraftState(
        beforeAircraft,
        afterAircraft,
        progress,
      )

      if (interpolatedAircraft) {
        interpolatedCatalog.push(interpolatedAircraft)
      }

      seenIcao24.add(beforeAircraft.icao24)
      return
    }

    if (progress < 0.5) {
      interpolatedCatalog.push(beforeAircraft)
    }
  })

  getAircraftCatalog(afterSnapshot).forEach((afterAircraft) => {
    if (seenIcao24.has(afterAircraft.icao24)) {
      return
    }

    if (progress >= 0.5) {
      interpolatedCatalog.push(afterAircraft)
    }
  })

  return sortAircraftForDisplay(interpolatedCatalog)
}

export function sampleAircraft(
  aircraft,
  limit = DEFAULT_AIRCRAFT_LIMIT,
  preferredIcao24 = [],
) {
  const sortedAircraft = sortAircraftForDisplay(aircraft)
  const normalizedLimit = Math.max(0, Math.floor(Number(limit) || 0))

  if (normalizedLimit === 0) {
    return []
  }

  if (sortedAircraft.length <= normalizedLimit) {
    return sortedAircraft
  }

  const sampledAircraft = []
  const seenIcao24 = new Set()
  const aircraftLookup = new Map(
    sortedAircraft.map((aircraftEntry) => [aircraftEntry.icao24, aircraftEntry]),
  )

  preferredIcao24.forEach((icao24) => {
    if (
      sampledAircraft.length >= normalizedLimit ||
      seenIcao24.has(icao24)
    ) {
      return
    }

    const aircraftEntry = aircraftLookup.get(icao24)

    if (!aircraftEntry) {
      return
    }

    sampledAircraft.push(aircraftEntry)
    seenIcao24.add(icao24)
  })

  if (sampledAircraft.length >= normalizedLimit) {
    return sampledAircraft
  }

  const remainingAircraft = sortedAircraft.filter(
    (aircraftEntry) => !seenIcao24.has(aircraftEntry.icao24),
  )
  const remainingSlots = normalizedLimit - sampledAircraft.length

  if (remainingAircraft.length <= remainingSlots) {
    return sampledAircraft.concat(remainingAircraft)
  }

  const step = remainingAircraft.length / remainingSlots

  for (let index = 0; index < remainingSlots; index += 1) {
    sampledAircraft.push(remainingAircraft[Math.floor(index * step)])
  }

  return sampledAircraft
}

export async function fetchAircraft() {
  try {
    const response = await axios.get(AIRCRAFT_STATES_ENDPOINT, {
      timeout: 15_000,
    })
    const aircraftStates = Array.isArray(response.data?.states)
      ? response.data.states
      : []
    const timestampMs = Number.isFinite(Number(response.data?.timeMs))
      ? Number(response.data.timeMs)
      : Number.isFinite(Number(response.data?.time))
        ? Number(response.data.time) * 1000
      : Date.now()

    return {
      source: response.data?.source ?? 'unknown',
      stale: Boolean(response.data?.stale),
      timestampMs,
      states: aircraftStates.map(normalizeAircraftState).filter(Boolean),
    }
  } catch (error) {
    console.error('Unable to fetch aircraft state data.', error)
    return {
      source: 'unknown',
      stale: false,
      timestampMs: Date.now(),
      states: [],
    }
  }
}
