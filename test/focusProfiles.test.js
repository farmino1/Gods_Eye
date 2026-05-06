import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computeFocusDistancesForDimensions,
  computeNodeScaleForDimensions,
  computeUniformScaleForDimensions,
  getAircraftFocusProfile,
  getCarFocusProfile,
  getShipFocusProfile,
} from '../src/utils/focusProfiles.js'

test('computeNodeScaleForDimensions maps target meters to model axes', () => {
  assert.deepEqual(
    computeNodeScaleForDimensions(
      {
        width: 10,
        height: 5,
        length: 20,
      },
      {
        width: 20,
        height: 15,
        length: 40,
      },
    ),
    {
      x: 2,
      y: 3,
      z: 2,
    },
  )
})

test('computeUniformScaleForDimensions finds a shared scale factor', () => {
  assert.equal(
    computeUniformScaleForDimensions(
      {
        width: 10,
        height: 5,
        length: 20,
      },
      {
        width: 20,
        height: 10,
        length: 40,
      },
    ),
    2,
  )
})

test('computeFocusDistancesForDimensions grows with object size', () => {
  const carFocus = computeFocusDistancesForDimensions({
    width: 1.86,
    height: 1.48,
    length: 4.55,
  })
  const shipFocus = computeFocusDistancesForDimensions({
    width: 32,
    height: 38,
    length: 210,
  })

  assert.ok(shipFocus.minimumZoomDistance > carFocus.minimumZoomDistance)
  assert.ok(shipFocus.defaultZoomDistance > shipFocus.minimumZoomDistance)
  assert.ok(shipFocus.maximumZoomDistance > shipFocus.defaultZoomDistance)
})

test('getAircraftFocusProfile uses broader dimensions for military aircraft', () => {
  const civilianProfile = getAircraftFocusProfile({
    isMilitary: false,
  })
  const militaryProfile = getAircraftFocusProfile({
    isMilitary: true,
  })

  assert.ok(
    militaryProfile.targetDimensions.length >
      civilianProfile.targetDimensions.length,
  )
  assert.ok(
    militaryProfile.focus.defaultZoomDistance >
      civilianProfile.focus.defaultZoomDistance,
  )
  assert.equal(civilianProfile.modelPath, '/models/aircraft-jet.glb')
  assert.ok(militaryProfile.modelScale > civilianProfile.modelScale)
})

test('getShipFocusProfile keeps ship renders on one small shared size profile', () => {
  const cargoProfile = getShipFocusProfile({
    type: 'cargo',
    isMilitary: false,
  })
  const fishingProfile = getShipFocusProfile({
    type: 'fishing',
    isMilitary: false,
  })
  const passengerProfile = getShipFocusProfile({
    type: 'passenger',
    isMilitary: false,
  })
  const militaryProfile = getShipFocusProfile({
    type: 'cargo',
    isMilitary: true,
  })

  assert.deepEqual(cargoProfile.targetDimensions, {
    width: 6,
    height: 8,
    length: 20,
  })
  assert.deepEqual(fishingProfile.targetDimensions, cargoProfile.targetDimensions)
  assert.deepEqual(passengerProfile.targetDimensions, cargoProfile.targetDimensions)
  assert.deepEqual(militaryProfile.targetDimensions, cargoProfile.targetDimensions)
  assert.equal(cargoProfile.modelPath, '/models/ship-cargo.glb')
  assert.equal(passengerProfile.modelPath, '/models/ship-cargo.glb')
  assert.equal(fishingProfile.modelPath, '/models/ship-fishing.glb')
  assert.equal(militaryProfile.modelPath, '/models/ship-battleship.glb')
  assert.ok(cargoProfile.modelScale > 0)
  assert.ok(cargoProfile.waterlineOffsetMeters >= 2.5)
  assert.ok(fishingProfile.waterlineOffsetMeters >= 2.5)
})

test('getCarFocusProfile returns sedan-scale target dimensions', () => {
  const carProfile = getCarFocusProfile()

  assert.deepEqual(carProfile.targetDimensions, {
    width: 1.86,
    height: 1.48,
    length: 4.55,
  })
  assert.ok(carProfile.focus.minimumZoomDistance >= 6)
})
