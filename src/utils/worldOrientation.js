import * as Cesium from 'cesium'

const scratchEast = new Cesium.Cartesian3()
const scratchNorth = new Cesium.Cartesian3()
const scratchUp = new Cesium.Cartesian3()
const scratchForward = new Cesium.Cartesian3()
const scratchLeft = new Cesium.Cartesian3()
const scratchRotationMatrix = new Cesium.Matrix3()

function toFiniteNumber(value, fallback = 0) {
  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) ? parsedValue : fallback
}

export function computeSurfaceAlignedAxis(
  { lat, lon } = {},
  result = new Cesium.Cartesian3(),
) {
  const latitudeRadians = Cesium.Math.toRadians(toFiniteNumber(lat))
  const longitudeRadians = Cesium.Math.toRadians(toFiniteNumber(lon))
  const sinLatitude = Math.sin(latitudeRadians)
  const cosLatitude = Math.cos(latitudeRadians)
  const sinLongitude = Math.sin(longitudeRadians)
  const cosLongitude = Math.cos(longitudeRadians)

  return Cesium.Cartesian3.fromElements(
    cosLatitude * cosLongitude,
    cosLatitude * sinLongitude,
    sinLatitude,
    result,
  )
}

export function computeSurfaceHeadingVector(
  { lat, lon, heading } = {},
  result = new Cesium.Cartesian3(),
) {
  const latitudeRadians = Cesium.Math.toRadians(toFiniteNumber(lat))
  const longitudeRadians = Cesium.Math.toRadians(toFiniteNumber(lon))
  const headingRadians = Cesium.Math.toRadians(toFiniteNumber(heading))
  const sinLatitude = Math.sin(latitudeRadians)
  const cosLatitude = Math.cos(latitudeRadians)
  const sinLongitude = Math.sin(longitudeRadians)
  const cosLongitude = Math.cos(longitudeRadians)

  Cesium.Cartesian3.fromElements(
    -sinLongitude,
    cosLongitude,
    0,
    scratchEast,
  )
  Cesium.Cartesian3.fromElements(
    -sinLatitude * cosLongitude,
    -sinLatitude * sinLongitude,
    cosLatitude,
    scratchNorth,
  )

  const eastWeight = Math.sin(headingRadians)
  const northWeight = Math.cos(headingRadians)

  Cesium.Cartesian3.multiplyByScalar(scratchEast, eastWeight, scratchEast)
  Cesium.Cartesian3.multiplyByScalar(
    scratchNorth,
    northWeight,
    scratchNorth,
  )
  Cesium.Cartesian3.add(scratchEast, scratchNorth, scratchForward)

  if (Cesium.Cartesian3.magnitudeSquared(scratchForward) <= Cesium.Math.EPSILON10) {
    return Cesium.Cartesian3.clone(Cesium.Cartesian3.UNIT_Z, result)
  }

  return Cesium.Cartesian3.normalize(scratchForward, result)
}

export function computeHeadingAlignedQuaternion(
  { lat, lon, heading } = {},
  result = new Cesium.Quaternion(),
  matrixResult,
) {
  computeSurfaceHeadingVector(
    {
      lat,
      lon,
      heading,
    },
    scratchForward,
  )
  computeSurfaceAlignedAxis(
    {
      lat,
      lon,
    },
    scratchUp,
  )

  if (Cesium.Cartesian3.magnitudeSquared(scratchForward) <= Cesium.Math.EPSILON10) {
    return Cesium.Quaternion.clone(Cesium.Quaternion.IDENTITY, result)
  }

  Cesium.Cartesian3.normalize(scratchForward, scratchForward)
  Cesium.Cartesian3.cross(scratchUp, scratchForward, scratchLeft)
  Cesium.Cartesian3.normalize(scratchLeft, scratchLeft)

  Cesium.Matrix3.clone(Cesium.Matrix3.IDENTITY, scratchRotationMatrix)
  Cesium.Matrix3.setColumn(
    scratchRotationMatrix,
    0,
    scratchForward,
    scratchRotationMatrix,
  )
  Cesium.Matrix3.setColumn(
    scratchRotationMatrix,
    1,
    scratchLeft,
    scratchRotationMatrix,
  )
  Cesium.Matrix3.setColumn(
    scratchRotationMatrix,
    2,
    scratchUp,
    scratchRotationMatrix,
  )

  if (matrixResult) {
    Cesium.Matrix3.clone(scratchRotationMatrix, matrixResult)
  }

  return Cesium.Quaternion.fromRotationMatrix(
    scratchRotationMatrix,
    result,
  )
}
