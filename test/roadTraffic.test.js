import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildRandomTrafficRoute,
  buildRoadTrafficGraph,
  getTrafficTargetCarCount,
} from '../src/services/roadTraffic.js'

function createSegment(id, points, roadClass = 'street', oneWay = 0) {
  return {
    id,
    roadClass,
    oneWay,
    points,
  }
}

test('buildRoadTrafficGraph extracts dead ends and directed edges from road segments', () => {
  const graph = buildRoadTrafficGraph({
    zoom: 11,
    segments: [
      createSegment('a', [0, 0, 0.01, 0]),
      createSegment('b', [0.01, 0, 0.02, 0]),
      createSegment('c', [0.01, 0, 0.01, 0.01], 'street', 1),
    ],
  })

  assert.equal(graph.nodes.length, 4)
  assert.equal(graph.edges.length, 5)
  assert.deepEqual(
    [...graph.deadEndNodeIds].sort(),
    ['0:0', '0:2000', '1000:1000'].sort(),
  )
})

test('buildRandomTrafficRoute connects one dead end to another dead end', () => {
  const graph = buildRoadTrafficGraph({
    zoom: 12,
    segments: [
      createSegment('west', [0, 0, 0.01, 0]),
      createSegment('north', [0.01, 0, 0.01, 0.01]),
      createSegment('east', [0.01, 0, 0.02, 0]),
      createSegment('south', [0.01, 0, 0.01, -0.01]),
    ],
  })
  const route = buildRandomTrafficRoute(graph, {
    startNodeId: '1000:1000',
    randomFn: () => 0.25,
  })

  assert.ok(route)
  assert.equal(route.startNodeId, '1000:1000')
  assert.notEqual(route.endNodeId, route.startNodeId)
  assert.ok(graph.deadEndNodeIds.includes(route.endNodeId))
  assert.ok(route.totalDistanceMeters > 0)
  assert.ok(route.points.length >= 2)
})

test('buildRoadTrafficGraph bridges close terminal gaps for broken roads', () => {
  const graph = buildRoadTrafficGraph({
    zoom: 13,
    segments: [
      createSegment('west', [0, 0, 0.001, 0]),
      createSegment('east', [0.00118, 0, 0.00218, 0]),
    ],
  })
  const route = buildRandomTrafficRoute(graph, {
    startNodeId: '0:0',
    randomFn: () => 0.25,
  })

  assert.equal(graph.syntheticConnectorCount, 2)
  assert.ok(route)
  assert.equal(route.startNodeId, '0:0')
  assert.equal(route.endNodeId, '0:218')
  assert.ok(route.totalDistanceMeters > 160)
})

test('buildRoadTrafficGraph annotates major intersections with synthetic traffic control metadata', () => {
  const graph = buildRoadTrafficGraph({
    zoom: 12,
    segments: [
      createSegment('west', [0, 0, 0.01, 0], 'primary'),
      createSegment('east', [0.01, 0, 0.02, 0], 'primary'),
      createSegment('north', [0.01, 0, 0.01, 0.01], 'secondary'),
      createSegment('south', [0.01, 0, 0.01, -0.01], 'secondary'),
    ],
  })
  const centerNode = graph.nodeById.get('0:1000')

  assert.ok(centerNode)
  assert.equal(centerNode.isIntersection, true)
  assert.equal(centerNode.controlType, 'light')
  assert.ok(Number.isFinite(centerNode.controlAxisHeadingDegrees))
})

test('buildRandomTrafficRoute exposes turn and junction metadata for runtime traffic rules', () => {
  const graph = buildRoadTrafficGraph({
    zoom: 12,
    segments: [
      createSegment('west', [0, 0, 0.01, 0], 'primary'),
      createSegment('east', [0.01, 0, 0.02, 0], 'primary'),
      createSegment('north', [0.01, 0, 0.01, 0.01], 'secondary'),
    ],
  })
  const route = buildRandomTrafficRoute(graph, {
    startNodeId: '0:0',
    randomFn: () => 0.9,
  })

  assert.ok(route)
  assert.equal(route.edgeSpans.length, 2)
  assert.ok(route.junctions.some((junction) => junction.controlType === 'light'))
  assert.ok(route.turns.some((turn) => turn.angleDegrees >= 80))
})

test('getTrafficTargetCarCount grows with zoom and dead-end availability', () => {
  const lowZoomGraph = {
    zoom: 8,
    deadEndNodeIds: new Array(24).fill('x'),
    edges: new Array(24).fill({}),
  }
  const highZoomGraph = {
    zoom: 11,
    deadEndNodeIds: new Array(24).fill('x'),
    edges: new Array(24).fill({}),
  }

  assert.equal(
    getTrafficTargetCarCount({ zoom: 10, deadEndNodeIds: [], edges: [] }),
    0,
  )
  assert.ok(getTrafficTargetCarCount(highZoomGraph) > getTrafficTargetCarCount(lowZoomGraph))
})
