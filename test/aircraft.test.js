import assert from 'node:assert/strict'
import test from 'node:test'
import {
  interpolateAircraftCatalogSnapshots,
  normalizeAircraftState,
} from '../src/services/aircraft.js'
import { getRenderAltitudeMeters } from '../src/layers/aircraft.js'

test('normalizeAircraftState extracts a clean aircraft object', () => {
  const normalizedState = normalizeAircraftState([
    'abcd12',
    'RCH123 ',
    'United States',
    null,
    1_700_000_000,
    -73.5,
    40.7,
    10_000,
    false,
    250,
    90,
    3,
    null,
    10_300,
  ])

  assert.equal(normalizedState.icao24, 'abcd12')
  assert.equal(normalizedState.callsign, 'RCH123')
  assert.equal(normalizedState.isMilitary, true)
  assert.equal(normalizedState.altitude, 10_300)
})

test('normalizeAircraftState respects explicit military flags from the proxy', () => {
  const normalizedState = normalizeAircraftState([
    'abcd12',
    'DAL123 ',
    'United States',
    null,
    1_700_000_000,
    -73.5,
    40.7,
    10_000,
    false,
    250,
    90,
    3,
    null,
    10_300,
    true,
  ])

  assert.equal(normalizedState.callsign, 'DAL123')
  assert.equal(normalizedState.isMilitary, true)
})

test('interpolateAircraftCatalogSnapshots blends matching aircraft and keeps edge cases stable', () => {
  const beforeSnapshot = {
    timestamp: 1_000,
    aircraftCatalog: [
      {
        icao24: 'abcd12',
        callsign: 'RCH123',
        originCountry: 'United States',
        lat: 0,
        lon: 0,
        altitude: 1_000,
        velocity: 200,
        heading: 90,
        verticalRate: 2,
        onGround: false,
        lastContact: 1_000,
        isMilitary: true,
      },
    ],
  }
  const afterSnapshot = {
    timestamp: 11_000,
    aircraftCatalog: [
      {
        icao24: 'abcd12',
        callsign: 'RCH123',
        originCountry: 'United States',
        lat: 10,
        lon: 10,
        altitude: 2_000,
        velocity: 220,
        heading: 110,
        verticalRate: 3,
        onGround: false,
        lastContact: 11_000,
        isMilitary: true,
      },
    ],
  }

  const [interpolatedAircraft] = interpolateAircraftCatalogSnapshots(
    beforeSnapshot,
    afterSnapshot,
    6_000,
  )

  assert.equal(interpolatedAircraft.icao24, 'abcd12')
  assert.equal(interpolatedAircraft.lat, 5)
  assert.equal(interpolatedAircraft.altitude, 1_500)
  assert.equal(interpolatedAircraft.velocity, 210)
})

test('getRenderAltitudeMeters keeps grounded aircraft on the sampled surface and clamps low aircraft above terrain', () => {
  assert.equal(
    getRenderAltitudeMeters({
      altitude: 285,
      onGround: true,
    }, {
      surfaceHeightMeters: 120,
    }),
    120.5,
  )

  assert.equal(
    getRenderAltitudeMeters({
      altitude: 40,
      onGround: false,
    }, {
      surfaceHeightMeters: 120,
    }),
    120.5,
  )

  assert.equal(
    getRenderAltitudeMeters({
      altitude: 1_200,
      onGround: false,
    }, {
      surfaceHeightMeters: 120,
    }),
    1_200,
  )
})
