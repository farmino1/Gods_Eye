import assert from 'node:assert/strict'
import test from 'node:test'
import * as Cesium from 'cesium'
import {
  computeHeadingAlignedQuaternion,
  computeSurfaceHeadingVector,
  computeSurfaceAlignedAxis,
} from '../src/utils/worldOrientation.js'

test('computeSurfaceAlignedAxis returns the local up vector', () => {
  const upAxis = computeSurfaceAlignedAxis({
    lat: 0,
    lon: 0,
  })

  assert.ok(Math.abs(upAxis.x - 1) < 1e-9)
  assert.ok(Math.abs(upAxis.y) < 1e-9)
  assert.ok(Math.abs(upAxis.z) < 1e-9)
})

test('computeHeadingAlignedQuaternion aligns local forward with heading on the globe', () => {
  const orientation = computeHeadingAlignedQuaternion({
    lat: 0,
    lon: 0,
    heading: 0,
  })
  const rotationMatrix = Cesium.Matrix3.fromQuaternion(
    orientation,
    new Cesium.Matrix3(),
  )
  const forward = Cesium.Matrix3.getColumn(
    rotationMatrix,
    0,
    new Cesium.Cartesian3(),
  )
  const upAxis = Cesium.Matrix3.getColumn(
    rotationMatrix,
    2,
    new Cesium.Cartesian3(),
  )

  assert.ok(Math.abs(forward.x) < 1e-9)
  assert.ok(Math.abs(forward.y) < 1e-9)
  assert.ok(Math.abs(forward.z - 1) < 1e-9)
  assert.ok(Math.abs(upAxis.x - 1) < 1e-9)
  assert.ok(Math.abs(upAxis.y) < 1e-9)
  assert.ok(Math.abs(upAxis.z) < 1e-9)
})

test('computeSurfaceHeadingVector returns the local heading direction on the globe', () => {
  const northHeading = computeSurfaceHeadingVector({
    lat: 0,
    lon: 0,
    heading: 0,
  })
  const eastHeading = computeSurfaceHeadingVector({
    lat: 0,
    lon: 0,
    heading: 90,
  })

  assert.ok(Math.abs(northHeading.x) < 1e-9)
  assert.ok(Math.abs(northHeading.y) < 1e-9)
  assert.ok(Math.abs(northHeading.z - 1) < 1e-9)
  assert.ok(Math.abs(eastHeading.x) < 1e-9)
  assert.ok(Math.abs(eastHeading.y - 1) < 1e-9)
  assert.ok(Math.abs(eastHeading.z) < 1e-9)
})
