import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseTleText,
  sampleSatellitesWithMilitaryPriority,
} from '../src/services/satellites.js'

const SAMPLE_TLE = `ISS (ZARYA)
1 25544U 98067A   24080.50000000  .00016717  00000+0  30000-3 0  9990
2 25544  51.6410 120.0000 0004820 120.0000 240.0000 15.50000000000000
USA 186
1 28888U 05042A   24080.50000000  .00000035  00000+0  00000-0 0  9997
2 28888   0.0100 120.0000 0001000  80.0000 100.0000  1.00270000000000`

test('parseTleText extracts valid TLE entries and classifies military names', () => {
  const satellites = parseTleText(SAMPLE_TLE)

  assert.equal(satellites.length, 2)
  assert.equal(satellites[0].noradId, '25544')
  assert.equal(satellites[1].isMilitary, true)
})

test('sampleSatellitesWithMilitaryPriority fills the cap with military satellites first', () => {
  const satellites = parseTleText(SAMPLE_TLE).concat(
    Array.from({ length: 3 }, (_, index) => ({
      name: `CIV-${index}`,
      line1: `1 4000${index}U 05042A   24080.50000000  .00000035  00000+0  00000-0 0  9997`,
      line2: `2 4000${index}   0.0100 120.0000 0001000  80.0000 100.0000  1.00270000000000`,
      noradId: `4000${index}`,
      isMilitary: false,
    })),
  )

  const sampled = sampleSatellitesWithMilitaryPriority(satellites, 1)

  assert.equal(sampled.length, 1)
  assert.equal(sampled.filter((satellite) => satellite.isMilitary).length, 1)
})

test('sampleSatellitesWithMilitaryPriority fills unused cap space with civilian satellites', () => {
  const satellites = parseTleText(SAMPLE_TLE).concat(
    Array.from({ length: 3 }, (_, index) => ({
      name: `CIV-${index}`,
      line1: `1 5000${index}U 05042A   24080.50000000  .00000035  00000+0  00000-0 0  9997`,
      line2: `2 5000${index}   0.0100 120.0000 0001000  80.0000 100.0000  1.00270000000000`,
      noradId: `5000${index}`,
      isMilitary: false,
    })),
  )

  const sampled = sampleSatellitesWithMilitaryPriority(satellites, 4)

  assert.equal(sampled.length, 4)
  assert.equal(sampled.filter((satellite) => satellite.isMilitary).length, 1)
  assert.equal(sampled.filter((satellite) => !satellite.isMilitary).length, 3)
})
