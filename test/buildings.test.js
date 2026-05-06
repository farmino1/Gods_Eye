import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resolveBuildingLayerConfig,
  shouldRenderBuildingsView,
} from '../src/layers/buildings.js'

test('shouldRenderBuildingsView requires a viewport', () => {
  assert.equal(shouldRenderBuildingsView(), false)
})

test('shouldRenderBuildingsView rejects views above the camera height limit', () => {
  assert.equal(
    shouldRenderBuildingsView({
      cameraHeightMeters: 6_001,
      viewRectangle: {
        west: -0.02,
        south: 51.49,
        east: 0.02,
        north: 51.51,
      },
    }),
    false,
  )
})

test('shouldRenderBuildingsView rejects views that are too wide', () => {
  assert.equal(
    shouldRenderBuildingsView({
      cameraHeightMeters: 3_000,
      viewRectangle: {
        west: -0.03,
        south: 51.48,
        east: 0.03,
        north: 51.51,
      },
    }),
    false,
  )
})

test('shouldRenderBuildingsView rejects views that are too tall', () => {
  assert.equal(
    shouldRenderBuildingsView({
      cameraHeightMeters: 3_000,
      viewRectangle: {
        west: -0.015,
        south: 51.47,
        east: 0.015,
        north: 51.511,
      },
    }),
    false,
  )
})

test('shouldRenderBuildingsView accepts city-scale camera views at the threshold', () => {
  assert.equal(
    shouldRenderBuildingsView({
      cameraHeightMeters: 6_000,
      viewRectangle: {
        west: -0.024,
        south: 51.48,
        east: 0.024,
        north: 51.514,
      },
    }),
    true,
  )
})

test('resolveBuildingLayerConfig extracts the optional photorealistic provider credentials', () => {
  assert.deepEqual(
    resolveBuildingLayerConfig({
      VITE_CESIUM_ION_TOKEN: ' ion-demo-token ',
    }),
    {
      cesiumIonToken: 'ion-demo-token',
    },
  )
})
