import axios from 'axios'

export const DEFAULT_SATELLITE_LIMIT = 100
export const SATELLITE_TLE_ENDPOINT = '/api/satellites/tle'
const MILITARY_NAME_KEYWORDS = [
  'AEHF',
  'COSMOS',
  'DSP',
  'KH-',
  'LACROSSE',
  'MENTOR',
  'MILSTAR',
  'MUOS',
  'NAVSTAR',
  'NROL',
  'ONYX',
  'ORION',
  'PARUS',
  'SBIRS',
  'SICRAL',
  'SKYNET',
  'STRELA',
  'TRUMPET',
  'USA ',
  'YAOGAN',
]

export function isMilitarySatelliteName(name) {
  const normalizedName = name.trim().toUpperCase()

  return MILITARY_NAME_KEYWORDS.some((keyword) =>
    normalizedName.includes(keyword),
  )
}

export function parseTleText(tleText) {
  if (!tleText) {
    return []
  }

  const lines = tleText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const satellites = []

  for (let index = 0; index + 2 < lines.length; index += 3) {
    const [name, line1, line2] = lines.slice(index, index + 3)

    if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) {
      continue
    }

    satellites.push({
      name,
      line1,
      line2,
      noradId: line1.slice(2, 7).trim(),
      isMilitary: isMilitarySatelliteName(name),
    })
  }

  return satellites
}

export function sampleSatellites(satellites, limit = DEFAULT_SATELLITE_LIMIT) {
  if (!Array.isArray(satellites) || satellites.length <= limit) {
    return satellites
  }

  const sampledSatellites = []
  const step = satellites.length / limit

  for (let index = 0; index < limit; index += 1) {
    sampledSatellites.push(satellites[Math.floor(index * step)])
  }

  return sampledSatellites
}

export function sampleSatellitesWithMilitaryPriority(
  satellites,
  limit = DEFAULT_SATELLITE_LIMIT,
) {
  if (!Array.isArray(satellites) || satellites.length === 0) {
    return []
  }

  const normalizedLimit = Math.max(1, Math.floor(Number(limit) || DEFAULT_SATELLITE_LIMIT))

  if (satellites.length <= normalizedLimit) {
    return satellites
  }

  const sourceOrder = new Map(
    satellites.map((satelliteTle, index) => [satelliteTle, index]),
  )
  const militarySatellites = satellites.filter((satelliteTle) => satelliteTle.isMilitary)
  const civilianSatellites = satellites.filter((satelliteTle) => !satelliteTle.isMilitary)
  const sampledMilitarySatellites = sampleSatellites(
    militarySatellites,
    normalizedLimit,
  )
  const remainingSlots = Math.max(0, normalizedLimit - sampledMilitarySatellites.length)
  const sampledCivilianSatellites = sampleSatellites(
    civilianSatellites,
    remainingSlots,
  )

  return [...sampledMilitarySatellites, ...sampledCivilianSatellites].sort(
    (leftSatellite, rightSatellite) =>
      sourceOrder.get(leftSatellite) - sourceOrder.get(rightSatellite),
  )
}

export async function fetchAllSatelliteTles() {
  const response = await axios.get(SATELLITE_TLE_ENDPOINT, {
    responseType: 'text',
  })

  return parseTleText(response.data)
}
