import {
  clampLatitude,
  formatBboxParam,
  isCoordinateWithinBbox,
  normalizeBbox,
  normalizeHeadingDegrees,
  padBbox,
  wrapLongitude,
} from '../src/utils/geo.js'

// The ship backend maintains one AISStream websocket and a recent in-memory
// vessel cache. Browser requests only ask for the currently relevant viewport,
// while the backend handles throttled subscription updates and merges static
// AIS messages with positional updates.
const AISSTREAM_PROVIDER = 'aisstream'
const UNCONFIGURED_PROVIDER = 'unconfigured'
const AISSTREAM_WS_URL = 'wss://stream.aisstream.io/v0/stream'
const SHIP_RETENTION_MS = 45 * 60 * 1000
const SUBSCRIPTION_THROTTLE_MS = 1_000
const RECONNECT_DELAY_MS = 4_000
const POSITION_MESSAGE_TYPES = new Set([
  'PositionReport',
  'StandardClassBPositionReport',
  'ExtendedClassBPositionReport',
  'LongRangeAisBroadcastMessage',
  'StandardSearchAndRescueAircraftReport',
])
const STATIC_MESSAGE_TYPES = new Set([
  'ShipStaticData',
  'StaticDataReport',
])
const SUBSCRIBED_MESSAGE_TYPES = [
  ...POSITION_MESSAGE_TYPES,
  ...STATIC_MESSAGE_TYPES,
]
const MILITARY_SHIP_PATTERNS = [
  /\bmilitary\b/i,
  /\bnavy\b/i,
  /\bnaval\b/i,
  /\bwarship\b/i,
  /\bcoast\s*guard\b/i,
  /\bpatrol\b/i,
  /\bfrigate\b/i,
  /\bdestroyer\b/i,
  /\bcorvette\b/i,
  /\bsubmarine\b/i,
  /\bcarrier\b/i,
  /\bauxiliary\b/i,
  /^uss\s/i,
  /^usns\s/i,
  /^hms\s/i,
  /^hmcs\s/i,
  /^hmas\s/i,
  /^hnlms\s/i,
  /^fs\s/i,
  /^its\s/i,
  /^rfa\s/i,
  /^tcg\s/i,
  /^bns\s/i,
  /^ins\s/i,
  /^jds\s/i,
  /^cgc\s/i,
]

function toTrimmedString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() || fallback : fallback
}

function toFiniteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') {
    return fallback
  }

  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) ? parsedValue : fallback
}

function cleanupAisText(value, fallback = '') {
  const cleanedValue = toTrimmedString(value)
    .replace(/@+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return cleanedValue || fallback
}

function normalizeImoNumber(value) {
  const cleanedValue = cleanupAisText(value)
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

function normalizeShipTypeFromNumber(value) {
  const numericType = toFiniteNumber(value)

  if (numericType === null) {
    return null
  }

  if (numericType === 30) {
    return 'fishing'
  }

  if (numericType === 35) {
    return 'military'
  }

  if ([31, 32, 52].includes(numericType)) {
    return 'tug'
  }

  if (numericType === 50) {
    return 'pilot'
  }

  if (numericType >= 60 && numericType < 70) {
    return 'passenger'
  }

  if (numericType >= 70 && numericType < 80) {
    return 'cargo'
  }

  if (numericType >= 80 && numericType < 90) {
    return 'tanker'
  }

  return 'other'
}

export function normalizeShipType(value) {
  const numericType = normalizeShipTypeFromNumber(value)

  if (numericType) {
    return numericType
  }

  const normalizedType = toTrimmedString(value, 'other').toLowerCase()

  if (normalizedType.includes('cargo')) {
    return 'cargo'
  }

  if (normalizedType.includes('tanker')) {
    return 'tanker'
  }

  if (normalizedType.includes('passenger')) {
    return 'passenger'
  }

  if (normalizedType.includes('fishing')) {
    return 'fishing'
  }

  if (
    normalizedType.includes('military') ||
    normalizedType.includes('navy') ||
    normalizedType.includes('naval') ||
    normalizedType.includes('warship') ||
    normalizedType.includes('coast guard') ||
    normalizedType.includes('patrol') ||
    normalizedType.includes('frigate') ||
    normalizedType.includes('destroyer') ||
    normalizedType.includes('corvette') ||
    normalizedType.includes('submarine')
  ) {
    return 'military'
  }

  if (
    normalizedType.includes('tug') ||
    normalizedType.includes('tow')
  ) {
    return 'tug'
  }

  if (normalizedType.includes('pilot')) {
    return 'pilot'
  }

  return 'other'
}

function normalizeShipId(value) {
  const normalizedId = cleanupAisText(value)

  if (normalizedId) {
    return normalizedId
  }

  const numericId = toFiniteNumber(value)
  return numericId === null ? '' : String(Math.trunc(numericId))
}

function isMilitaryShipMetadata({
  type,
  name,
  callsign,
  destination,
}) {
  if (type === 'military') {
    return true
  }

  return [name, callsign, destination].some((fieldValue) =>
    MILITARY_SHIP_PATTERNS.some((pattern) =>
      pattern.test(cleanupAisText(fieldValue)),
    ),
  )
}

function getMessageBody(payload, messageType) {
  const message = payload?.Message

  if (!message || typeof message !== 'object') {
    return null
  }

  if (messageType && message[messageType] && typeof message[messageType] === 'object') {
    return message[messageType]
  }

  return Object.values(message).find(
    (value) => value && typeof value === 'object',
  ) || null
}

function getShipMmsi(payload, body) {
  return normalizeShipId(
    body?.UserID ??
      body?.MMSI ??
      body?.ShipID ??
      payload?.MetaData?.MMSI ??
      payload?.Metadata?.MMSI ??
      payload?.MetaData?.UserID ??
      payload?.Metadata?.UserID,
  )
}

function normalizeShipUpdate(update, fallbackMmsi, receivedAtMs) {
  const mmsi = normalizeShipId(update?.mmsi ?? fallbackMmsi)

  if (!mmsi) {
    return null
  }

  const lat = toFiniteNumber(update?.lat)
  const lon = toFiniteNumber(update?.lon)
  const rawSpeedKnots = toFiniteNumber(update?.speedKnots)
  const rawHeadingDegrees = toFiniteNumber(
    update?.headingDegrees ?? update?.courseDegrees,
  )
  const rawCourseDegrees = toFiniteNumber(
    update?.courseDegrees ?? update?.headingDegrees,
  )
  const type =
    update?.type === undefined ||
    update?.type === null ||
    update?.type === ''
      ? ''
      : normalizeShipType(update.type)
  const name = cleanupAisText(update?.name, '')
  const callsign = cleanupAisText(update?.callsign, '')
  const destination = cleanupAisText(update?.destination, '')
  const imo = normalizeImoNumber(update?.imo)
  const isMilitary =
    typeof update?.isMilitary === 'boolean'
      ? update.isMilitary
      : isMilitaryShipMetadata({
        type,
        name,
        callsign,
        destination,
      })

  return {
    id: mmsi,
    mmsi,
    lat: lat === null ? null : clampLatitude(lat),
    lon: lon === null ? null : wrapLongitude(lon),
    speedKnots: rawSpeedKnots === null ? null : Math.max(0, rawSpeedKnots),
    headingDegrees:
      rawHeadingDegrees === null
        ? null
        : normalizeHeadingDegrees(rawHeadingDegrees),
    courseDegrees:
      rawCourseDegrees === null
        ? null
        : normalizeHeadingDegrees(rawCourseDegrees),
    type,
    name,
    callsign,
    destination,
    imo,
    isMilitary,
    lastSeenMs: toFiniteNumber(update?.lastSeenMs, receivedAtMs),
  }
}

function mergeShipRecord(existingRecord, nextUpdate, receivedAtMs = Date.now()) {
  if (!nextUpdate?.mmsi) {
    return existingRecord ?? null
  }

  const update = normalizeShipUpdate(
    nextUpdate,
    nextUpdate.mmsi,
    receivedAtMs,
  )

  if (!update) {
    return existingRecord ?? null
  }

  return {
    id: update.id,
    mmsi: update.mmsi,
    lat: update.lat ?? existingRecord?.lat ?? null,
    lon: update.lon ?? existingRecord?.lon ?? null,
    speedKnots: update.speedKnots ?? existingRecord?.speedKnots ?? 0,
    headingDegrees:
      update.headingDegrees ?? existingRecord?.headingDegrees ?? 0,
    courseDegrees:
      update.courseDegrees ??
      existingRecord?.courseDegrees ??
      update.headingDegrees ??
      0,
    type: update.type || existingRecord?.type || 'other',
    name: update.name || existingRecord?.name || `MMSI ${update.mmsi}`,
    callsign: update.callsign || existingRecord?.callsign || 'Unavailable',
    destination:
      update.destination || existingRecord?.destination || 'Unavailable',
    imo: update.imo || existingRecord?.imo || '',
    isMilitary: Boolean(update.isMilitary || existingRecord?.isMilitary),
    lastSeenMs: update.lastSeenMs ?? existingRecord?.lastSeenMs ?? receivedAtMs,
  }
}

function sortShipsForResponse(ships) {
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

export function normalizeAisStreamMessage(payload, receivedAtMs = Date.now()) {
  const messageType = toTrimmedString(payload?.MessageType)
  const metadata = payload?.MetaData ?? payload?.Metadata ?? {}
  const body = getMessageBody(payload, messageType)
  const mmsi = getShipMmsi(payload, body)

  if (!mmsi || !body) {
    return null
  }

  const baseUpdate = {
    mmsi,
    lat:
      toFiniteNumber(body.Latitude) ??
      toFiniteNumber(metadata.Latitude),
    lon:
      toFiniteNumber(body.Longitude) ??
      toFiniteNumber(metadata.Longitude),
    speedKnots:
      toFiniteNumber(body.Sog) ??
      toFiniteNumber(body.SpeedOverGround) ??
      toFiniteNumber(metadata.Sog),
    headingDegrees:
      toFiniteNumber(body.TrueHeading) ??
      toFiniteNumber(body.Heading) ??
      toFiniteNumber(metadata.TrueHeading) ??
      toFiniteNumber(metadata.Heading),
    courseDegrees:
      toFiniteNumber(body.Cog) ??
      toFiniteNumber(body.CourseOverGround) ??
      toFiniteNumber(metadata.Cog) ??
      toFiniteNumber(metadata.CourseOverGround),
    type:
      body.Type ??
      body.ShipType ??
      metadata.ShipType ??
      metadata.Type,
    name:
      body.Name ??
      body.ShipName ??
      metadata.ShipName ??
      metadata.Name,
    callsign:
      body.CallSign ??
      body.Callsign ??
      metadata.CallSign ??
      metadata.Callsign,
    destination: body.Destination ?? metadata.Destination,
    imo:
      body.IMO ??
      body.Imo ??
      body.ImoNumber ??
      body.IMONumber ??
      metadata.IMO ??
      metadata.Imo ??
      metadata.ImoNumber ??
      metadata.IMONumber,
    lastSeenMs: receivedAtMs,
  }

  if (
    !POSITION_MESSAGE_TYPES.has(messageType) &&
    !STATIC_MESSAGE_TYPES.has(messageType)
  ) {
    return null
  }

  return normalizeShipUpdate(baseUpdate, mmsi, receivedAtMs)
}

export function resolveShipProvider(env = process.env) {
  return toTrimmedString(env.AISSTREAM_API_KEY)
    ? AISSTREAM_PROVIDER
    : UNCONFIGURED_PROVIDER
}

export function createShipDataClient({
  env = process.env,
  logger = console,
} = {}) {
  const provider = resolveShipProvider(env)
  const vesselCache = new Map()
  const apiKey = toTrimmedString(env.AISSTREAM_API_KEY)
  const websocketCtor = globalThis.WebSocket
  const state = {
    socket: null,
    desiredSubscriptionBbox: null,
    lastAppliedSubscriptionKey: '',
    lastSubscriptionSentAtMs: 0,
    reconnectTimeoutId: null,
    subscriptionTimeoutId: null,
    isDestroyed: false,
  }

  function pruneStaleShips(nowMs = Date.now()) {
    vesselCache.forEach((shipRecord, shipId) => {
      if (nowMs - shipRecord.lastSeenMs > SHIP_RETENTION_MS) {
        vesselCache.delete(shipId)
      }
    })
  }

  function buildSubscriptionMessage(bbox) {
    return JSON.stringify({
      APIKey: apiKey,
      BoundingBoxes: [
        [
          [bbox.south, bbox.west],
          [bbox.north, bbox.east],
        ],
      ],
      FilterMessageTypes: SUBSCRIBED_MESSAGE_TYPES,
    })
  }

  function clearReconnectTimeout() {
    if (state.reconnectTimeoutId !== null) {
      clearTimeout(state.reconnectTimeoutId)
      state.reconnectTimeoutId = null
    }
  }

  function clearSubscriptionTimeout() {
    if (state.subscriptionTimeoutId !== null) {
      clearTimeout(state.subscriptionTimeoutId)
      state.subscriptionTimeoutId = null
    }
  }

  function scheduleReconnect() {
    if (
      state.isDestroyed ||
      provider !== AISSTREAM_PROVIDER ||
      state.reconnectTimeoutId !== null
    ) {
      return
    }

    state.reconnectTimeoutId = setTimeout(() => {
      state.reconnectTimeoutId = null
      ensureStreamConnection()
    }, RECONNECT_DELAY_MS)
  }

  function applyIncomingMessage(payload) {
    const normalizedMessage = normalizeAisStreamMessage(payload, Date.now())

    if (!normalizedMessage) {
      return
    }

    const existingShipRecord = vesselCache.get(normalizedMessage.id) ?? null
    const mergedShipRecord = mergeShipRecord(
      existingShipRecord,
      normalizedMessage,
      normalizedMessage.lastSeenMs,
    )

    if (!mergedShipRecord) {
      return
    }

    vesselCache.set(mergedShipRecord.id, mergedShipRecord)
  }

  async function parseMessageEventData(data) {
    if (typeof data === 'string') {
      return data
    }

    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      return data.text()
    }

    if (data instanceof ArrayBuffer) {
      return Buffer.from(data).toString('utf8')
    }

    if (ArrayBuffer.isView(data)) {
      return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8')
    }

    return ''
  }

  function sendSubscriptionIfReady({ force = false } = {}) {
    const socket = state.socket
    const bbox = state.desiredSubscriptionBbox

    if (!bbox || !socket || socket.readyState !== websocketCtor.OPEN) {
      return
    }

    const subscriptionKey = formatBboxParam(bbox)
    const nowMs = Date.now()

    // AISStream expects subscription updates to be throttled. This keeps camera
    // movement from turning into a burst of websocket messages.
    if (!force && subscriptionKey === state.lastAppliedSubscriptionKey) {
      clearSubscriptionTimeout()
      return
    }

    if (
      !force &&
      nowMs - state.lastSubscriptionSentAtMs < SUBSCRIPTION_THROTTLE_MS
    ) {
      clearSubscriptionTimeout()
      state.subscriptionTimeoutId = setTimeout(() => {
        state.subscriptionTimeoutId = null
        sendSubscriptionIfReady()
      }, Math.max(0, SUBSCRIPTION_THROTTLE_MS - (nowMs - state.lastSubscriptionSentAtMs)))
      return
    }

    socket.send(buildSubscriptionMessage(bbox))
    state.lastAppliedSubscriptionKey = subscriptionKey
    state.lastSubscriptionSentAtMs = nowMs
  }

  function ensureStreamConnection() {
    if (
      provider !== AISSTREAM_PROVIDER ||
      !apiKey ||
      !websocketCtor ||
      state.isDestroyed
    ) {
      return
    }

    if (
      state.socket &&
      (
        state.socket.readyState === websocketCtor.OPEN ||
        state.socket.readyState === websocketCtor.CONNECTING
      )
    ) {
      return
    }

    clearReconnectTimeout()
    const socket = new websocketCtor(AISSTREAM_WS_URL)
    state.socket = socket

    socket.addEventListener('open', () => {
      sendSubscriptionIfReady({ force: true })
    })

    socket.addEventListener('message', async (event) => {
      try {
        const rawMessage = await parseMessageEventData(event.data)

        if (!rawMessage || !rawMessage.trim()) {
          return
        }

        const messagePayload = JSON.parse(rawMessage)
        applyIncomingMessage(messagePayload)
      } catch (error) {
        logger.error('Unable to parse AISStream ship message.', error)
      }
    })

    socket.addEventListener('error', (error) => {
      logger.error('AISStream websocket error.', error)
    })

    socket.addEventListener('close', () => {
      if (state.socket === socket) {
        state.socket = null
      }

      state.lastAppliedSubscriptionKey = ''
      clearSubscriptionTimeout()
      scheduleReconnect()
    })
  }

  function updateDesiredSubscriptionBbox(bbox) {
    const normalizedBbox = normalizeBbox(bbox)

    if (!normalizedBbox) {
      return
    }

    // We pad the requested view so small camera nudges do not immediately drop
    // vessels that are just outside the visible frame.
    state.desiredSubscriptionBbox = padBbox(normalizedBbox, {
      latitudeRatio: 0.18,
      longitudeRatio: 0.18,
      minLatitudePad: 0.2,
      minLongitudePad: 0.2,
      maxLatitudePad: 8,
      maxLongitudePad: 12,
    })

    ensureStreamConnection()
    sendSubscriptionIfReady()
  }

  function getVisibleShips(bbox) {
    pruneStaleShips()

    const normalizedBbox = normalizeBbox(bbox)
    const ships = [...vesselCache.values()].filter((shipRecord) => {
      if (
        !Number.isFinite(shipRecord.lat) ||
        !Number.isFinite(shipRecord.lon)
      ) {
        return false
      }

      return normalizedBbox
        ? isCoordinateWithinBbox(shipRecord.lat, shipRecord.lon, normalizedBbox)
        : true
    })

    return sortShipsForResponse(ships)
  }

  return {
    resolveProvider() {
      return provider
    },

    isStreamingProvider() {
      return provider === AISSTREAM_PROVIDER
    },

    async fetchShips({ bbox } = {}) {
      if (provider === AISSTREAM_PROVIDER) {
        if (!websocketCtor) {
          logger.error(
            'WebSocket is unavailable in this Node runtime, so AISStream ship tracking cannot start.',
          )

          return {
            configured: false,
            source: provider,
            timeMs: Date.now(),
            ships: [],
          }
        }

        updateDesiredSubscriptionBbox(bbox)

        return {
          configured: true,
          source: provider,
          timeMs: Date.now(),
          ships: getVisibleShips(bbox),
        }
      }

      return {
        configured: false,
        source: provider,
        timeMs: Date.now(),
        ships: [],
      }
    },

    destroy() {
      state.isDestroyed = true
      clearReconnectTimeout()
      clearSubscriptionTimeout()

      if (
        state.socket &&
        websocketCtor &&
        (
          state.socket.readyState === websocketCtor.OPEN ||
          state.socket.readyState === websocketCtor.CONNECTING
        )
      ) {
        state.socket.close()
      }

      state.socket = null
    },
  }
}
