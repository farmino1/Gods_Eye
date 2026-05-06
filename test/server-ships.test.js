import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createShipDataClient,
  normalizeAisStreamMessage,
  normalizeShipType,
  resolveShipProvider,
} from '../server/ships.js'

test('resolveShipProvider enables AISStream only when a key is configured', () => {
  assert.equal(
    resolveShipProvider({
      AISSTREAM_API_KEY: 'test-key',
    }),
    'aisstream',
  )
  assert.equal(resolveShipProvider({}), 'unconfigured')
})

test('normalizeShipType maps both numeric and textual categories', () => {
  assert.equal(normalizeShipType(70), 'cargo')
  assert.equal(normalizeShipType(31), 'tug')
  assert.equal(normalizeShipType(35), 'military')
  assert.equal(normalizeShipType('Passenger Ferry'), 'passenger')
})

test('normalizeAisStreamMessage extracts live position reports', () => {
  const normalizedMessage = normalizeAisStreamMessage(
    {
      MessageType: 'PositionReport',
      MetaData: {
        ShipName: 'KV FARM',
      },
      Message: {
        PositionReport: {
          UserID: 257069200,
          Latitude: 51.44458833333333,
          Longitude: 3.590816666666667,
          Sog: 12.4,
          Cog: 95,
          TrueHeading: 97,
        },
      },
    },
    1_800_000_000_000,
  )

  assert.equal(normalizedMessage.id, '257069200')
  assert.equal(normalizedMessage.name, 'KV FARM')
  assert.equal(normalizedMessage.speedKnots, 12.4)
  assert.equal(normalizedMessage.courseDegrees, 95)
  assert.equal(normalizedMessage.headingDegrees, 97)
  assert.equal(normalizedMessage.lastSeenMs, 1_800_000_000_000)
})

test('normalizeAisStreamMessage extracts static ship metadata cleanly', () => {
  const normalizedMessage = normalizeAisStreamMessage(
    {
      MessageType: 'ShipStaticData',
      Message: {
        ShipStaticData: {
          UserID: 257069200,
          Name: 'KV FARM@@@@@@',
          CallSign: 'LBHF',
          Destination: 'COASTGUARD@@@@@@@@H',
          Type: 50,
          IMO: 9234567,
        },
      },
    },
    1_800_000_000_000,
  )

  assert.equal(normalizedMessage.id, '257069200')
  assert.equal(normalizedMessage.type, 'pilot')
  assert.equal(normalizedMessage.name, 'KV FARM')
  assert.equal(normalizedMessage.callsign, 'LBHF')
  assert.equal(normalizedMessage.destination, 'COASTGUARD H')
  assert.equal(normalizedMessage.imo, '9234567')
  assert.equal(normalizedMessage.lat, null)
  assert.equal(normalizedMessage.lon, null)
})

test('normalizeAisStreamMessage flags military vessels from type and name metadata', () => {
  const normalizedMessage = normalizeAisStreamMessage(
    {
      MessageType: 'StaticDataReport',
      Message: {
        StaticDataReport: {
          UserID: 369998000,
          Name: 'HMS EXAMPLE',
          Type: 35,
        },
      },
    },
    1_800_000_000_000,
  )

  assert.equal(normalizedMessage.id, '369998000')
  assert.equal(normalizedMessage.type, 'military')
  assert.equal(normalizedMessage.isMilitary, true)
})

test('createShipDataClient subscribes to AISStream and returns visible ships', async (t) => {
  const originalWebSocket = globalThis.WebSocket

  class FakeWebSocket {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3
    static instances = []

    constructor(url) {
      this.url = url
      this.readyState = FakeWebSocket.CONNECTING
      this.sentMessages = []
      this.listeners = new Map()
      FakeWebSocket.instances.push(this)
    }

    addEventListener(type, handler) {
      if (!this.listeners.has(type)) {
        this.listeners.set(type, new Set())
      }

      this.listeners.get(type).add(handler)
    }

    send(payload) {
      this.sentMessages.push(payload)
    }

    emit(type, event = {}) {
      for (const handler of this.listeners.get(type) ?? []) {
        handler(event)
      }
    }

    open() {
      this.readyState = FakeWebSocket.OPEN
      this.emit('open')
    }

    close() {
      if (this.readyState === FakeWebSocket.CLOSED) {
        return
      }

      this.readyState = FakeWebSocket.CLOSED
      this.emit('close')
    }
  }

  globalThis.WebSocket = FakeWebSocket
  t.after(() => {
    globalThis.WebSocket = originalWebSocket
  })

  const client = createShipDataClient({
    env: {
      AISSTREAM_API_KEY: 'test-key',
    },
    logger: {
      error() {},
    },
  })

  t.after(() => {
    client.destroy()
  })

  const bbox = {
    west: 2,
    south: 50,
    east: 4,
    north: 52,
  }

  const initialPayload = await client.fetchShips({ bbox })
  assert.equal(initialPayload.configured, true)
  assert.equal(initialPayload.ships.length, 0)
  assert.equal(FakeWebSocket.instances.length, 1)

  const socket = FakeWebSocket.instances[0]
  assert.equal(socket.url, 'wss://stream.aisstream.io/v0/stream')
  socket.open()

  assert.equal(socket.sentMessages.length, 1)
  const subscription = JSON.parse(socket.sentMessages[0])
  assert.equal(subscription.APIKey, 'test-key')
  assert.equal(subscription.FilterMessageTypes.length > 0, true)
  assert.equal(subscription.BoundingBoxes.length, 1)

  socket.emit('message', {
    data: new Blob([
      JSON.stringify({
        MessageType: 'PositionReport',
        MetaData: {
          ShipName: 'KV FARM',
        },
        Message: {
          PositionReport: {
            UserID: 257069200,
            Latitude: 51.44458833333333,
            Longitude: 3.590816666666667,
            Sog: 12.4,
            Cog: 95,
            TrueHeading: 97,
          },
        },
      }),
    ]),
  })

  await new Promise((resolve) => setTimeout(resolve, 0))

  const nextPayload = await client.fetchShips({ bbox })
  assert.equal(nextPayload.configured, true)
  assert.equal(nextPayload.ships.length, 1)
  assert.equal(nextPayload.ships[0].mmsi, '257069200')
  assert.equal(nextPayload.ships[0].name, 'KV FARM')
  assert.equal(nextPayload.ships[0].headingDegrees, 97)
  assert.equal(nextPayload.ships[0].isMilitary, false)
})
