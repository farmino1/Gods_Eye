import * as satellite from 'satellite.js'

const satrecCache = new WeakMap()
const DEFAULT_ORBIT_DURATION_MINUTES = 90
const MAX_ORBIT_SAMPLES = 72

function getSatrec(tle) {
  if (!tle || !tle.line1 || !tle.line2) {
    return null
  }

  if (!satrecCache.has(tle)) {
    satrecCache.set(tle, satellite.twoline2satrec(tle.line1, tle.line2))
  }

  return satrecCache.get(tle)
}

function getPropagatedState(tle, time) {
  const satrec = getSatrec(tle)

  if (!satrec) {
    return null
  }

  const propagated = satellite.propagate(satrec, time)

  if (!propagated || !propagated.position || !propagated.velocity) {
    return null
  }

  const gmst = satellite.gstime(time)
  const geodetic = satellite.eciToGeodetic(propagated.position, gmst)
  const lat = satellite.degreesLat(geodetic.latitude)
  const lon = satellite.degreesLong(geodetic.longitude)
  const height = geodetic.height * 1000

  if (![lat, lon, height].every(Number.isFinite)) {
    return null
  }

  const velocityVector = propagated.velocity
  const velocityKmS = Math.sqrt(
    velocityVector.x ** 2 + velocityVector.y ** 2 + velocityVector.z ** 2,
  )

  if (!Number.isFinite(velocityKmS)) {
    return null
  }

  return {
    lat,
    lon,
    height,
    velocityKmS,
  }
}

export function getSatelliteState(tle, time = new Date()) {
  return getPropagatedState(tle, time)
}

export function getSatellitePosition(tle, time = new Date()) {
  const state = getSatelliteState(tle, time)

  if (!state) {
    return null
  }

  return {
    lat: state.lat,
    lon: state.lon,
    height: state.height,
  }
}

export function getSatelliteVelocityKmS(tle, time = new Date()) {
  const state = getSatelliteState(tle, time)

  if (!state) {
    return null
  }

  return state.velocityKmS
}

export function getOrbitPeriodMinutes(tle) {
  const satrec = getSatrec(tle)

  if (!satrec || !Number.isFinite(satrec.no) || satrec.no <= 0) {
    return DEFAULT_ORBIT_DURATION_MINUTES
  }

  return (2 * Math.PI) / satrec.no
}

export function getOrbitTrail(
  tle,
  startTime = new Date(),
  durationMinutes = null,
  stepMinutes = 3,
) {
  const satrec = getSatrec(tle)
  const trail = []

  if (!satrec) {
    return trail
  }

  const orbitDurationMinutes =
    durationMinutes ?? getOrbitPeriodMinutes(tle)
  const sampleStepMinutes = Math.max(
    stepMinutes,
    orbitDurationMinutes / MAX_ORBIT_SAMPLES,
  )
  const totalSteps = Math.max(
    1,
    Math.ceil(orbitDurationMinutes / sampleStepMinutes),
  )
  const referenceGmst = satellite.gstime(startTime)
  const halfOrbitDurationMinutes = orbitDurationMinutes / 2

  for (let step = 0; step <= totalSteps; step += 1) {
    const progress = step / totalSteps
    const elapsedMinutes =
      progress * orbitDurationMinutes - halfOrbitDurationMinutes
    const sampleTime = new Date(startTime.getTime() + elapsedMinutes * 60_000)
    const propagated = satellite.propagate(satrec, sampleTime)

    if (!propagated?.position) {
      continue
    }

    // Render the full orbit in the current Earth frame so the focused path is a
    // closed orbit ring around the globe instead of a time-evolving ground track.
    const earthFixedPosition = satellite.eciToEcf(
      propagated.position,
      referenceGmst,
    )

    if (
      ![
        earthFixedPosition.x,
        earthFixedPosition.y,
        earthFixedPosition.z,
      ].every(Number.isFinite)
    ) {
      continue
    }

    trail.push({
      x: earthFixedPosition.x * 1000,
      y: earthFixedPosition.y * 1000,
      z: earthFixedPosition.z * 1000,
    })
  }

  if (trail.length > 2) {
    trail.push({
      ...trail[0],
    })
  }

  return trail
}
