export function clampLatitude(latitude) {
  const parsedLatitude = Number(latitude)

  if (!Number.isFinite(parsedLatitude)) {
    return 0
  }

  return Math.max(-90, Math.min(90, parsedLatitude))
}

export function wrapLongitude(longitude) {
  const parsedLongitude = Number(longitude)

  if (!Number.isFinite(parsedLongitude)) {
    return 0
  }

  const wrappedLongitude = ((parsedLongitude + 540) % 360) - 180

  return wrappedLongitude === -180 ? 180 : wrappedLongitude
}

export function normalizeHeadingDegrees(value) {
  const parsedHeading = Number(value)

  if (!Number.isFinite(parsedHeading)) {
    return 0
  }

  return ((parsedHeading % 360) + 360) % 360
}

export function normalizeBbox(bbox) {
  if (!bbox || typeof bbox !== 'object') {
    return null
  }

  const south = clampLatitude(Math.min(Number(bbox.south), Number(bbox.north)))
  const north = clampLatitude(Math.max(Number(bbox.south), Number(bbox.north)))

  return {
    west: wrapLongitude(bbox.west),
    south,
    east: wrapLongitude(bbox.east),
    north,
  }
}

export function getBboxSpans(bbox) {
  const normalizedBbox = normalizeBbox(bbox)

  if (!normalizedBbox) {
    return {
      latitudeSpan: 0,
      longitudeSpan: 0,
    }
  }

  const longitudeSpan =
    normalizedBbox.west <= normalizedBbox.east
      ? normalizedBbox.east - normalizedBbox.west
      : 360 - normalizedBbox.west + normalizedBbox.east

  return {
    latitudeSpan: Math.max(0, normalizedBbox.north - normalizedBbox.south),
    longitudeSpan,
  }
}

export function padBbox(
  bbox,
  {
    latitudeRatio = 0.12,
    longitudeRatio = 0.12,
    minLatitudePad = 0.15,
    minLongitudePad = 0.15,
    maxLatitudePad = 12,
    maxLongitudePad = 20,
  } = {},
) {
  const normalizedBbox = normalizeBbox(bbox)

  if (!normalizedBbox) {
    return null
  }

  const spans = getBboxSpans(normalizedBbox)
  const latitudePad = Math.min(
    maxLatitudePad,
    Math.max(minLatitudePad, spans.latitudeSpan * latitudeRatio),
  )
  const longitudePad = Math.min(
    maxLongitudePad,
    Math.max(minLongitudePad, spans.longitudeSpan * longitudeRatio),
  )

  return normalizeBbox({
    west: normalizedBbox.west - longitudePad,
    south: normalizedBbox.south - latitudePad,
    east: normalizedBbox.east + longitudePad,
    north: normalizedBbox.north + latitudePad,
  })
}

export function isLongitudeWithinBbox(longitude, bbox) {
  const normalizedBbox = normalizeBbox(bbox)
  const normalizedLongitude = wrapLongitude(longitude)

  if (!normalizedBbox) {
    return false
  }

  if (normalizedBbox.west <= normalizedBbox.east) {
    return (
      normalizedLongitude >= normalizedBbox.west &&
      normalizedLongitude <= normalizedBbox.east
    )
  }

  return (
    normalizedLongitude >= normalizedBbox.west ||
    normalizedLongitude <= normalizedBbox.east
  )
}

export function isCoordinateWithinBbox(lat, lon, bbox) {
  const normalizedBbox = normalizeBbox(bbox)

  if (!normalizedBbox) {
    return false
  }

  return (
    clampLatitude(lat) >= normalizedBbox.south &&
    clampLatitude(lat) <= normalizedBbox.north &&
    isLongitudeWithinBbox(lon, normalizedBbox)
  )
}

export function formatBboxParam(bbox) {
  const normalizedBbox = normalizeBbox(bbox)

  if (!normalizedBbox) {
    return ''
  }

  return [
    normalizedBbox.west.toFixed(5),
    normalizedBbox.south.toFixed(5),
    normalizedBbox.east.toFixed(5),
    normalizedBbox.north.toFixed(5),
  ].join(',')
}

export function parseBboxParam(value) {
  if (typeof value !== 'string') {
    return null
  }

  const parts = value
    .split(',')
    .map((part) => Number(part.trim()))

  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return null
  }

  return normalizeBbox({
    west: parts[0],
    south: parts[1],
    east: parts[2],
    north: parts[3],
  })
}

export function snapBbox(bbox, precisionDegrees = 0.05) {
  const normalizedBbox = normalizeBbox(bbox)
  const precision = Math.max(0.0001, Number(precisionDegrees) || 0.05)

  if (!normalizedBbox) {
    return null
  }

  const snap = (value) => Math.round(value / precision) * precision

  return normalizeBbox({
    west: snap(normalizedBbox.west),
    south: snap(normalizedBbox.south),
    east: snap(normalizedBbox.east),
    north: snap(normalizedBbox.north),
  })
}

export function getBboxCenter(bbox) {
  const normalizedBbox = normalizeBbox(bbox)

  if (!normalizedBbox) {
    return null
  }

  const spans = getBboxSpans(normalizedBbox)

  return {
    lat: (normalizedBbox.south + normalizedBbox.north) / 2,
    lon: wrapLongitude(normalizedBbox.west + spans.longitudeSpan / 2),
  }
}
