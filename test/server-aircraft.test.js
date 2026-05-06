import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeOpenSkyPayload,
  resolveAircraftProvider,
} from '../server/aircraft.js'

test('resolveAircraftProvider always returns opensky', () => {
  assert.equal(resolveAircraftProvider(), 'opensky')
})

test('normalizeOpenSkyPayload preserves state rows and expands seconds timestamps', () => {
  const payload = normalizeOpenSkyPayload({
    time: 1_700_000_000,
    states: [['abcd12']],
  })

  assert.equal(payload.provider, 'opensky')
  assert.equal(payload.time, 1_700_000_000)
  assert.equal(payload.timeMs, 1_700_000_000_000)
  assert.deepEqual(payload.states, [['abcd12']])
})
