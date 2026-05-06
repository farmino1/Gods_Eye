const AIRCRAFT_MODEL_PATH = '/models/aircraft-jet.glb'
const FISHING_SHIP_MODEL_PATH = '/models/ship-fishing.glb'
const CARGO_SHIP_MODEL_PATH = '/models/ship-cargo.glb'
const BATTLESHIP_MODEL_PATH = '/models/ship-battleship.glb'

const AIRCRAFT_SOURCE_DIMENSIONS_METERS = {
  width: 129.732864,
  height: 39.565569,
  length: 136.649399,
}

const CAR_SOURCE_DIMENSIONS_METERS = {
  width: 5.198768834706785,
  height: 4.940873288613882,
  length: 11.604830382922682,
}

const AIRCRAFT_TARGET_DIMENSIONS_METERS = {
  civilian: {
    width: 35.8,
    height: 11.76,
    length: 37.57,
  },
  military: {
    width: 51.75,
    height: 16.79,
    length: 53.04,
  },
}

const SHIP_TARGET_DIMENSIONS_METERS = {
  width: 6,
  height: 8,
  length: 20,
}

const CAR_TARGET_DIMENSIONS_METERS = {
  width: 1.86,
  height: 1.48,
  length: 4.55,
}

const SHIP_MODEL_ASSETS = {
  fishing: {
    modelPath: FISHING_SHIP_MODEL_PATH,
    sourceDimensions: {
      width: 410.003799,
      height: 558.040966,
      length: 929.050781,
    },
    sourceMinHeightMeters: -27.840954,
  },
  cargo: {
    modelPath: CARGO_SHIP_MODEL_PATH,
    sourceDimensions: {
      width: 0.210022,
      height: 0.381347,
      length: 0.975,
    },
    sourceMinHeightMeters: -0.196758,
  },
  military: {
    modelPath: BATTLESHIP_MODEL_PATH,
    sourceDimensions: {
      width: 0.54213,
      height: 0.903946,
      length: 2.879362,
    },
    sourceMinHeightMeters: -0.534676,
  },
}

function clampPositiveNumber(value, fallback = 1) {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) && numericValue > 0
    ? numericValue
    : fallback
}

export function computeNodeScaleForDimensions(
  sourceDimensions,
  targetDimensions,
) {
  return {
    x:
      clampPositiveNumber(targetDimensions?.width) /
      clampPositiveNumber(sourceDimensions?.width),
    y:
      clampPositiveNumber(targetDimensions?.height) /
      clampPositiveNumber(sourceDimensions?.height),
    z:
      clampPositiveNumber(targetDimensions?.length) /
      clampPositiveNumber(sourceDimensions?.length),
  }
}

export function computeUniformScaleForDimensions(
  sourceDimensions,
  targetDimensions,
) {
  const sourceVector = [
    clampPositiveNumber(sourceDimensions?.width),
    clampPositiveNumber(sourceDimensions?.height),
    clampPositiveNumber(sourceDimensions?.length),
  ]
  const targetVector = [
    clampPositiveNumber(targetDimensions?.width),
    clampPositiveNumber(targetDimensions?.height),
    clampPositiveNumber(targetDimensions?.length),
  ]
  const denominator = sourceVector.reduce(
    (sum, component) => sum + component ** 2,
    0,
  )

  if (!(denominator > 0)) {
    return 1
  }

  return sourceVector.reduce(
    (sum, component, index) => sum + component * targetVector[index],
    0,
  ) / denominator
}

export function computeFocusDistancesForDimensions(
  dimensions,
  {
    minimumFactor = 2.3,
    defaultFactor = 6.6,
    maximumFactor = 24,
    minimumFloor = 8,
    maximumFloor = 120,
  } = {},
) {
  const width = clampPositiveNumber(dimensions?.width)
  const height = clampPositiveNumber(dimensions?.height)
  const length = clampPositiveNumber(dimensions?.length)
  const radius = Math.hypot(width, height, length) * 0.5

  return {
    minimumZoomDistance: Math.max(minimumFloor, radius * minimumFactor),
    defaultZoomDistance: Math.max(
      minimumFloor * 1.75,
      radius * defaultFactor,
    ),
    maximumZoomDistance: Math.max(maximumFloor, radius * maximumFactor),
  }
}

export function getAircraftFocusProfile(aircraft = {}) {
  const targetDimensions = aircraft?.isMilitary
    ? AIRCRAFT_TARGET_DIMENSIONS_METERS.military
    : AIRCRAFT_TARGET_DIMENSIONS_METERS.civilian

  return {
    modelPath: AIRCRAFT_MODEL_PATH,
    modelScale: computeUniformScaleForDimensions(
      AIRCRAFT_SOURCE_DIMENSIONS_METERS,
      targetDimensions,
    ),
    sourceDimensions: AIRCRAFT_SOURCE_DIMENSIONS_METERS,
    targetDimensions,
    focus: {
      ...computeFocusDistancesForDimensions(targetDimensions, {
        minimumFactor: 2.4,
        defaultFactor: 6.9,
        maximumFactor: 22,
        minimumFloor: 38,
        maximumFloor: 420,
      }),
      defaultPitchDegrees: -18,
    },
  }
}

export function getShipFocusProfile(ship = {}) {
  const modelProfileKey = ship?.isMilitary
    ? 'military'
    : ship?.type === 'fishing'
      ? 'fishing'
      : 'cargo'
  const targetDimensions = SHIP_TARGET_DIMENSIONS_METERS
  const modelAsset = SHIP_MODEL_ASSETS[modelProfileKey]
  const modelScale = computeUniformScaleForDimensions(
    modelAsset.sourceDimensions,
    targetDimensions,
  )
  // Cesium's ocean surface and terrain depth testing can visually swallow hulls
  // that only clear the water by a few decimeters, so ships get a deliberate
  // freeboard lift instead of a near-zero waterline offset.
  const waterlineClearanceMeters = Math.max(
    2.5,
    clampPositiveNumber(targetDimensions.height, 2.5) * 0.16,
  )

  return {
    modelPath: modelAsset.modelPath,
    modelScale,
    sourceDimensions: modelAsset.sourceDimensions,
    targetDimensions,
    waterlineOffsetMeters:
      Math.max(0, -modelAsset.sourceMinHeightMeters * modelScale) +
      waterlineClearanceMeters,
    focus: {
      ...computeFocusDistancesForDimensions(targetDimensions, {
        minimumFactor: 2.2,
        defaultFactor: 6.4,
        maximumFactor: 20,
        minimumFloor: 55,
        maximumFloor: 650,
      }),
      defaultPitchDegrees: -20,
    },
  }
}

export function getCarFocusProfile() {
  return {
    rootNodeName: 'RootNode',
    sourceDimensions: CAR_SOURCE_DIMENSIONS_METERS,
    targetDimensions: CAR_TARGET_DIMENSIONS_METERS,
    nodeScale: computeNodeScaleForDimensions(
      CAR_SOURCE_DIMENSIONS_METERS,
      CAR_TARGET_DIMENSIONS_METERS,
    ),
    focus: {
      ...computeFocusDistancesForDimensions(CAR_TARGET_DIMENSIONS_METERS, {
        minimumFactor: 2.35,
        defaultFactor: 6.3,
        maximumFactor: 21,
        minimumFloor: 6,
        maximumFloor: 140,
      }),
      defaultPitchDegrees: -16,
    },
  }
}
