import { wrapLongitude } from './geo'

function interpolatePoint(startPoint, endPoint, startValue, endValue, level) {
  const denominator = endValue - startValue
  const progress =
    Math.abs(denominator) < 0.000001
      ? 0.5
      : (level - startValue) / denominator

  return {
    lat: startPoint.lat + (endPoint.lat - startPoint.lat) * progress,
    lon: wrapLongitude(startPoint.lon + (endPoint.lon - startPoint.lon) * progress),
  }
}

function getGridPoint(grid, lonSteps, yi, xi) {
  return grid[yi * (lonSteps + 1) + xi] || null
}

function buildCellSegments(corners, level) {
  const intersections = []
  const addIntersection = (startCorner, endCorner) => {
    const startDelta = startCorner.value - level
    const endDelta = endCorner.value - level

    if (
      (startDelta < 0 && endDelta < 0) ||
      (startDelta > 0 && endDelta > 0)
    ) {
      return
    }

    intersections.push(
      interpolatePoint(
        startCorner.position,
        endCorner.position,
        startCorner.value,
        endCorner.value,
        level,
      ),
    )
  }

  addIntersection(corners.southWest, corners.southEast)
  addIntersection(corners.southEast, corners.northEast)
  addIntersection(corners.northEast, corners.northWest)
  addIntersection(corners.northWest, corners.southWest)

  if (intersections.length < 2) {
    return []
  }

  if (intersections.length === 2) {
    return [[intersections[0], intersections[1]]]
  }

  if (intersections.length === 4) {
    return [
      [intersections[0], intersections[1]],
      [intersections[2], intersections[3]],
    ]
  }

  return []
}

export function buildWeatherContours(
  payload,
  accessor,
  levels,
) {
  const grid = Array.isArray(payload?.grid) ? payload.grid : []
  const latSteps = Number(payload?.resolution?.latSteps)
  const lonSteps = Number(payload?.resolution?.lonSteps)

  if (!grid.length || !Number.isFinite(latSteps) || !Number.isFinite(lonSteps)) {
    return []
  }

  const contours = []

  for (const level of levels) {
    for (let yi = 0; yi < latSteps; yi += 1) {
      for (let xi = 0; xi < lonSteps; xi += 1) {
        const southWest = getGridPoint(grid, lonSteps, yi, xi)
        const southEast = getGridPoint(grid, lonSteps, yi, xi + 1)
        const northWest = getGridPoint(grid, lonSteps, yi + 1, xi)
        const northEast = getGridPoint(grid, lonSteps, yi + 1, xi + 1)

        if (!southWest || !southEast || !northWest || !northEast) {
          continue
        }

        const segments = buildCellSegments(
          {
            southWest: {
              position: southWest,
              value: accessor(southWest),
            },
            southEast: {
              position: southEast,
              value: accessor(southEast),
            },
            northEast: {
              position: northEast,
              value: accessor(northEast),
            },
            northWest: {
              position: northWest,
              value: accessor(northWest),
            },
          },
          level,
        )

        segments.forEach((segment) => {
          contours.push({
            level,
            points: segment,
          })
        })
      }
    }
  }

  return contours
}
