import assert from 'node:assert/strict'
import test from 'node:test'
import {
  shouldRenderShipAsVolume,
  shouldRenderShipDetailModel,
} from '../src/layers/ships.js'
import {
  interpolateShipCatalogSnapshots,
  normalizeShipState,
} from '../src/services/ships.js'

test('normalizeShipState produces a render-safe ship object', () => {
  const shipState = normalizeShipState({
    id: '257069200',
    mmsi: '257069200',
    lat: 51.5,
    lon: 181.2,
    speedKnots: 14.5,
    headingDegrees: 91,
    courseDegrees: 95,
    type: 'Cargo',
    name: 'KV FARM',
    imo: '9234567',
  })

  assert.equal(shipState.id, '257069200')
  assert.ok(Math.abs(shipState.lon + 178.8) < 0.000001)
  assert.equal(shipState.type, 'cargo')
  assert.ok(Math.abs(shipState.speedMS - 7.459438) < 0.000001)
  assert.equal(shipState.callsign, 'Unavailable')
  assert.equal(shipState.imo, '9234567')
  assert.equal(
    shipState.moreInfoUrl,
    'https://shipinfo.net/vessels_map.php?imo=9234567',
  )
})

test('normalizeShipState preserves military vessels and military ship types', () => {
  const shipState = normalizeShipState({
    id: '369998000',
    mmsi: '369998000',
    lat: 54.1,
    lon: -1.2,
    type: 'Military patrol',
    name: 'HMS EXAMPLE',
  })

  assert.equal(shipState.type, 'military')
  assert.equal(shipState.isMilitary, true)
})

test('normalizeShipState falls back to MMSI for shipinfo lookup links', () => {
  const shipState = normalizeShipState({
    id: '257069200',
    mmsi: '257069200',
    lat: 51.5,
    lon: 3.4,
  })

  assert.equal(
    shipState.moreInfoUrl,
    'https://shipinfo.net/vessels_map.php?imo=257069200',
  )
})

test('interpolateShipCatalogSnapshots supports legacy ship catalogs and wraps longitude', () => {
  const [shipState] = interpolateShipCatalogSnapshots(
    {
      timestamp: 1_000,
      shipCatalog: [
        {
          id: '257069200',
          mmsi: '257069200',
          lat: 0,
          lon: 179,
          speedKnots: 10,
          speedMS: 5.14444,
          heading: 350,
          course: 355,
          timestampMs: 1_000,
        },
      ],
    },
    {
      timestamp: 11_000,
      catalog: [
        {
          id: '257069200',
          mmsi: '257069200',
          lat: 10,
          lon: -179,
          speedKnots: 20,
          speedMS: 10.28888,
          heading: 10,
          course: 5,
          timestampMs: 11_000,
        },
      ],
    },
    6_000,
  )

  assert.equal(shipState.lat, 5)
  assert.equal(shipState.lon, 180)
  assert.equal(shipState.heading, 0)
  assert.equal(shipState.course, 0)
  assert.equal(shipState.speedKnots, 15)
})

test('shouldRenderShipAsVolume matches the close traffic zoom thresholds', () => {
  assert.equal(
    shouldRenderShipAsVolume({
      cameraHeightMeters: 7_500,
      viewRectangle: {
        west: -0.03,
        south: 51.48,
        east: 0.03,
        north: 51.53,
      },
    }),
    true,
  )

  assert.equal(
    shouldRenderShipAsVolume({
      cameraHeightMeters: 7_501,
      viewRectangle: {
        west: -0.03,
        south: 51.48,
        east: 0.03,
        north: 51.53,
      },
    }),
    false,
  )
})

test('shouldRenderShipDetailModel keeps a focused ship in 3D outside the close zoom threshold', () => {
  assert.equal(
    shouldRenderShipDetailModel({
      cameraHeightMeters: 25_000,
      viewRectangle: {
        west: -2,
        south: 50,
        east: 2,
        north: 53,
      },
      isSelected: true,
    }),
    true,
  )

  assert.equal(
    shouldRenderShipDetailModel({
      cameraHeightMeters: 25_000,
      viewRectangle: {
        west: -2,
        south: 50,
        east: 2,
        north: 53,
      },
      isSelected: false,
    }),
    false,
  )
})
