import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCameraSpatialIndex,
  buildCameraViewportPayload,
  filterCameraCatalogByViewport,
  normalizeCameraRecord,
  resolveCameraViewportLevel,
} from '../server/cameras.js'

const SAMPLE_CAMERA_CATALOG = [
  normalizeCameraRecord({
    id: 'us-ca-la-1',
    name: 'Downtown LA',
    city: 'Los Angeles',
    state: 'California',
    country: 'US',
    lat: 34.0522,
    lng: -118.2437,
    feed_url: 'https://example.test/la.jpg',
    feed_type: 'image',
    active: 1,
    source: 'sample',
  }),
  normalizeCameraRecord({
    id: 'us-ca-sf-1',
    name: 'Market Street',
    city: 'San Francisco',
    state: 'California',
    country: 'US',
    lat: 37.7749,
    lng: -122.4194,
    feed_url: 'https://example.test/sf.jpg',
    feed_type: 'image',
    active: 1,
    source: 'sample',
  }),
  normalizeCameraRecord({
    id: 'us-nv-vegas-1',
    name: 'Strip',
    city: 'Las Vegas',
    state: 'Nevada',
    country: 'US',
    lat: 36.1699,
    lng: -115.1398,
    feed_url: 'https://example.test/vegas.jpg',
    feed_type: 'image',
    active: 1,
    source: 'sample',
  }),
  normalizeCameraRecord({
    id: 'ca-on-toronto-1',
    name: 'Gardiner',
    city: 'Toronto',
    state: 'Ontario',
    country: 'CA',
    lat: 43.6532,
    lng: -79.3832,
    feed_url: 'https://example.test/toronto.jpg',
    feed_type: 'image',
    active: 1,
    source: 'sample',
  }),
].filter(Boolean)

test('normalizeCameraRecord drops inactive or duplicate camera rows', () => {
  assert.equal(
    normalizeCameraRecord({
      id: 'inactive-camera',
      lat: 1,
      lng: 2,
      feed_url: 'https://example.test/cam.jpg',
      active: 0,
    }),
    null,
  )

  assert.equal(
    normalizeCameraRecord({
      id: 'duplicate-camera',
      lat: 1,
      lng: 2,
      feed_url: 'https://example.test/cam.jpg',
      active: 1,
      duplicate_of: 'camera-1',
    }),
    null,
  )
})

test('resolveCameraViewportLevel steps from country to camera as views tighten', () => {
  assert.equal(
    resolveCameraViewportLevel({
      bbox: {
        west: -180,
        south: -90,
        east: 180,
        north: 90,
      },
      heightMeters: 8_000_000,
    }),
    'country',
  )

  assert.equal(
    resolveCameraViewportLevel({
      bbox: {
        west: -125,
        south: 32,
        east: -111,
        north: 43,
      },
      heightMeters: 500_000,
    }),
    'state',
  )

  assert.equal(
    resolveCameraViewportLevel({
      bbox: {
        west: -123.5,
        south: 36.6,
        east: -121.7,
        north: 38.4,
      },
      heightMeters: 120_000,
    }),
    'city',
  )

  assert.equal(
    resolveCameraViewportLevel({
      bbox: {
        west: -118.5,
        south: 33.95,
        east: -118.1,
        north: 34.25,
      },
      heightMeters: 45_000,
    }),
    'camera',
  )
})

test('buildCameraViewportPayload aggregates visible cameras by state', () => {
  const payload = buildCameraViewportPayload(SAMPLE_CAMERA_CATALOG, {
    bbox: {
      west: -125,
      south: 32,
      east: -111,
      north: 43,
    },
    heightMeters: 500_000,
  })

  assert.equal(payload.level, 'state')
  assert.equal(payload.visibleCameraCount, 3)
  assert.equal(payload.itemCount, 2)
  assert.equal(payload.items[0].label, 'California')
  assert.equal(payload.items[0].count, 2)
  assert.equal(payload.items[1].label, 'Nevada')
  assert.equal(payload.items[1].count, 1)
})

test('buildCameraViewportPayload returns individual cameras when zoomed close', () => {
  const payload = buildCameraViewportPayload(SAMPLE_CAMERA_CATALOG, {
    bbox: {
      west: -118.6,
      south: 33.9,
      east: -118.1,
      north: 34.2,
    },
    heightMeters: 35_000,
  })

  assert.equal(payload.level, 'camera')
  assert.equal(payload.visibleCameraCount, 1)
  assert.equal(payload.itemCount, 1)
  assert.equal(payload.items[0].type, 'camera')
  assert.equal(payload.items[0].name, 'Downtown LA')
  assert.equal(payload.items[0].feedUrl, 'https://example.test/la.jpg')
})

test('filterCameraCatalogByViewport uses the spatial index and supports dateline views', () => {
  const datelineCatalog = [
    normalizeCameraRecord({
      id: 'dateline-east',
      name: 'East of dateline',
      city: 'Dateline East',
      state: 'Pacific',
      country: 'Test',
      lat: 10,
      lng: 179.6,
      feed_url: 'https://example.test/east.jpg',
      feed_type: 'image',
      active: 1,
      source: 'sample',
    }),
    normalizeCameraRecord({
      id: 'dateline-west',
      name: 'West of dateline',
      city: 'Dateline West',
      state: 'Pacific',
      country: 'Test',
      lat: 12,
      lng: -179.7,
      feed_url: 'https://example.test/west.jpg',
      feed_type: 'image',
      active: 1,
      source: 'sample',
    }),
    normalizeCameraRecord({
      id: 'far-away',
      name: 'Far Away',
      city: 'Far Away',
      state: 'Elsewhere',
      country: 'Test',
      lat: 48,
      lng: -30,
      feed_url: 'https://example.test/far.jpg',
      feed_type: 'image',
      active: 1,
      source: 'sample',
    }),
  ].filter(Boolean)
  const spatialIndex = buildCameraSpatialIndex(datelineCatalog)
  const candidates = filterCameraCatalogByViewport(
    datelineCatalog,
    spatialIndex,
    {
      west: 179.4,
      south: 0,
      east: -179.4,
      north: 20,
    },
  )

  assert.deepEqual(
    candidates.map((camera) => camera.id).sort(),
    ['dateline-east', 'dateline-west'],
  )
})

test('buildCameraViewportPayload preserves total count when given prefiltered candidates', () => {
  const spatialIndex = buildCameraSpatialIndex(SAMPLE_CAMERA_CATALOG)
  const visibleCameraCatalog = filterCameraCatalogByViewport(
    SAMPLE_CAMERA_CATALOG,
    spatialIndex,
    {
      west: -118.6,
      south: 33.9,
      east: -118.1,
      north: 34.2,
    },
  )
  const payload = buildCameraViewportPayload(SAMPLE_CAMERA_CATALOG, {
    bbox: {
      west: -118.6,
      south: 33.9,
      east: -118.1,
      north: 34.2,
    },
    heightMeters: 35_000,
    visibleCameraCatalog,
  })

  assert.equal(payload.totalCameraCount, SAMPLE_CAMERA_CATALOG.length)
  assert.equal(payload.visibleCameraCount, 1)
  assert.equal(payload.itemCount, 1)
  assert.equal(payload.items[0].id, 'us-ca-la-1')
})
