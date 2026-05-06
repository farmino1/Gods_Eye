import assert from 'node:assert/strict'
import test from 'node:test'
import { createRoadLayer } from '../src/layers/roads.js'
import {
  doBboxesIntersect,
  getBuildingPolygonsFromGeometry,
  getRoadRenderStyle,
  getRoadVectorZoomForBbox,
  getVectorTileCoverage,
  isRoutableRoadFeature,
  normalizeRoadClass,
  resolveBuildingHeightRange,
  resolveRoadSourceDescriptor,
} from '../src/services/roads.js'

test('normalizeRoadClass collapses road aliases and filters non-routable features', () => {
  assert.equal(normalizeRoadClass({ class: 'motorway_link' }), 'motorway')
  assert.equal(normalizeRoadClass({ class: 'residential' }), 'street')
  assert.equal(isRoutableRoadFeature({ class: 'primary' }), true)
  assert.equal(isRoutableRoadFeature({ class: 'ferry' }), false)
  assert.equal(isRoutableRoadFeature({ class: 'path' }), false)
})

test('getRoadRenderStyle only enables smaller roads once zoomed in enough', () => {
  assert.deepEqual(getRoadRenderStyle('motorway', 7), {
    color: '#f59e0b',
    width: 6,
    minZoom: 7,
    priority: 70,
    roadClass: 'motorway',
  })
  assert.equal(getRoadRenderStyle('street', 10), null)
  assert.deepEqual(getRoadRenderStyle('residential', 11), {
    color: '#e2e8f0',
    width: 1.75,
    minZoom: 11,
    priority: 10,
    roadClass: 'street',
  })
})

test('resolveRoadSourceDescriptor prefers the road style source and resolves relative tiles', () => {
  const descriptor = resolveRoadSourceDescriptor({
    styleUrl: 'https://tiles.openfreemap.org/styles/liberty',
    tileSourceUrl: 'https://tiles.openfreemap.org/planet',
    styleDocument: {
      version: 8,
      sources: {
        labels: {
          type: 'vector',
          url: 'https://example.com/labels.json',
        },
        planet: {
          type: 'vector',
          url: '/planet',
        },
      },
      layers: [
        {
          id: 'country_labels',
          type: 'symbol',
          source: 'labels',
          'source-layer': 'place',
        },
        {
          id: 'road_motorway',
          type: 'line',
          source: 'planet',
          'source-layer': 'transportation',
        },
      ],
    },
    tileSourceDocument: {
      tiles: ['/tiles/v3/{z}/{x}/{y}.pbf'],
      minzoom: 0,
      maxzoom: 14,
      vector_layers: [
        { id: 'transportation' },
        { id: 'transportation_name' },
      ],
    },
  })

  assert.deepEqual(descriptor, {
    sourceName: 'planet',
    sourceLayerNames: ['transportation'],
    roadSourceLayerNames: ['transportation'],
    buildingSourceLayerNames: [],
    tileTemplates: ['https://tiles.openfreemap.org/tiles/v3/{z}/{x}/{y}.pbf'],
    minzoom: 0,
    maxzoom: 14,
  })
})

test('resolveRoadSourceDescriptor detects building layers from fill-extrusion styles', () => {
  const descriptor = resolveRoadSourceDescriptor({
    styleDocument: {
      version: 8,
      sources: {
        planet: {
          type: 'vector',
          tiles: ['https://example.com/tiles/{z}/{x}/{y}.pbf'],
          minzoom: 0,
          maxzoom: 14,
        },
      },
      layers: [
        {
          id: 'building-3d',
          type: 'fill-extrusion',
          source: 'planet',
          'source-layer': 'building',
        },
      ],
    },
  })

  assert.deepEqual(descriptor, {
    sourceName: 'planet',
    sourceLayerNames: [],
    roadSourceLayerNames: [],
    buildingSourceLayerNames: ['building'],
    tileTemplates: ['https://example.com/tiles/{z}/{x}/{y}.pbf'],
    minzoom: 0,
    maxzoom: 14,
  })
})

test('resolveRoadSourceDescriptor falls back to vector_layers for buildings', () => {
  const descriptor = resolveRoadSourceDescriptor({
    styleDocument: {
      version: 8,
      sources: {
        planet: {
          type: 'vector',
          url: 'https://example.com/planet.json',
        },
      },
      layers: [],
    },
    tileSourceUrl: 'https://example.com/planet.json',
    tileSourceDocument: {
      tiles: ['/tiles/{z}/{x}/{y}.pbf'],
      minzoom: 1,
      maxzoom: 13,
      vector_layers: [
        { id: 'transportation_name' },
        { id: 'building' },
      ],
    },
  })

  assert.deepEqual(descriptor, {
    sourceName: 'planet',
    sourceLayerNames: [],
    roadSourceLayerNames: [],
    buildingSourceLayerNames: ['building'],
    tileTemplates: ['https://example.com/tiles/{z}/{x}/{y}.pbf'],
    minzoom: 1,
    maxzoom: 13,
  })
})

test('getRoadVectorZoomForBbox scales detail with viewport size', () => {
  assert.equal(
    getRoadVectorZoomForBbox({
      west: -0.15,
      south: 51.45,
      east: 0.08,
      north: 51.6,
    }),
    12,
  )
  assert.equal(
    getRoadVectorZoomForBbox({
      west: -20,
      south: 40,
      east: 18,
      north: 62,
    }),
    7,
  )
})

test('getVectorTileCoverage handles dateline views without duplicate tiles', () => {
  const tiles = getVectorTileCoverage(
    {
      west: 170,
      south: 10,
      east: -170,
      north: 18,
    },
    4,
  )
  const tileKeys = tiles.map((tile) => tile.key)

  assert.equal(tileKeys.length, new Set(tileKeys).size)
  assert.ok(tileKeys.includes('4/15/7'))
  assert.ok(tileKeys.includes('4/0/7'))
})

test('doBboxesIntersect supports wrapped longitudes', () => {
  assert.equal(
    doBboxesIntersect(
      {
        west: 170,
        south: 5,
        east: -170,
        north: 20,
      },
      {
        west: 175,
        south: 8,
        east: 178,
        north: 12,
      },
    ),
    true,
  )
  assert.equal(
    doBboxesIntersect(
      {
        west: 170,
        south: 5,
        east: -170,
        north: 20,
      },
      {
        west: -120,
        south: 8,
        east: -100,
        north: 12,
      },
    ),
    false,
  )
})

test('resolveBuildingHeightRange applies explicit heights, levels fallback, and clamps', () => {
  assert.deepEqual(
    resolveBuildingHeightRange({
      render_height: '42.5',
      render_min_height: '8',
    }),
    {
      heightMeters: 42.5,
      minHeightMeters: 8,
      hasAuthoritativeHeight: true,
    },
  )

  assert.deepEqual(
    resolveBuildingHeightRange({
      'building:levels': '5',
    }),
    {
      heightMeters: 16,
      minHeightMeters: 0,
      hasAuthoritativeHeight: true,
    },
  )

  assert.deepEqual(
    resolveBuildingHeightRange({
      'building:part:levels': '7',
      'building:min_level': '2',
    }),
    {
      heightMeters: 22.400000000000002,
      minHeightMeters: 6.4,
      hasAuthoritativeHeight: true,
    },
  )

  assert.deepEqual(
    resolveBuildingHeightRange({
      height: 999,
      min_height: 500,
    }),
    {
      heightMeters: 250,
      minHeightMeters: 249,
      hasAuthoritativeHeight: true,
    },
  )

  assert.deepEqual(resolveBuildingHeightRange({}), {
    heightMeters: 12,
    minHeightMeters: 0,
    hasAuthoritativeHeight: false,
  })
})

test('getBuildingPolygonsFromGeometry normalizes polygons, preserves holes, and skips invalid rings', () => {
  const polygons = getBuildingPolygonsFromGeometry({
    type: 'Polygon',
    coordinates: [
      [
        [10, 20],
        [12, 20],
        [12, 22],
        [10, 22],
      ],
      [
        [10.5, 20.5],
        [11.5, 20.5],
        [11.5, 21.5],
        [10.5, 21.5],
        [10.5, 20.5],
      ],
      [
        [10.1, 20.1],
        [10.1, 20.1],
      ],
    ],
  })

  assert.equal(polygons.length, 1)
  assert.equal(polygons[0].rings.length, 2)
  assert.deepEqual(polygons[0].bbox, {
    west: 10,
    south: 20,
    east: 12,
    north: 22,
  })
  assert.deepEqual(polygons[0].rings[0], [
    10, 20,
    12, 20,
    12, 22,
    10, 22,
    10, 20,
  ])
})

test('getBuildingPolygonsFromGeometry supports multipolygons and drops degenerate outers', () => {
  const polygons = getBuildingPolygonsFromGeometry({
    type: 'MultiPolygon',
    coordinates: [
      [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
      [
        [
          [2, 2],
          [2, 2],
          [2, 2],
        ],
      ],
      [
        [
          [3, 3],
          [4, 3],
          [4, 4],
          [3, 4],
          [3, 3],
        ],
      ],
    ],
  })

  assert.equal(polygons.length, 2)
  assert.deepEqual(
    polygons.map((polygon) => polygon.bbox),
    [
      {
        west: 0,
        south: 0,
        east: 1,
        north: 1,
      },
      {
        west: 3,
        south: 3,
        east: 4,
        north: 4,
      },
    ],
  )
})

test('createRoadLayer leaves an injected road network alive on destroy', () => {
  const roadNetwork = {
    destroyCalls: 0,
    destroy() {
      this.destroyCalls += 1
    },
    getSnapshot() {
      return {
        zoom: null,
        tiles: [],
        segments: [],
        buildings: [],
      }
    },
    warmViewport() {
      return Promise.resolve([])
    },
  }

  const roadLayer = createRoadLayer({
    viewer: {},
    roadNetwork,
  })

  roadLayer.destroy()

  assert.equal(roadNetwork.destroyCalls, 0)
})
