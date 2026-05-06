import * as Cesium from 'cesium'
import { fetchGpsJammingData } from '../services/gpsJamming.js'
import { getJammingColor } from '../services/gpsJamming.js'
import { cellToBoundary } from 'h3-js'

const REFRESH_INTERVAL_MS = 5 * 60 * 1000 // Refresh every 5 minutes

export function createGpsJammingLayer({
  viewer,
  initialTimeMs = Date.now(),
  onStatusChange,
} = {}) {
  const dataSource = new Cesium.CustomDataSource('gps-jamming')
  const hexEntries = new Map()

  let attached = false
  let destroyed = false
  let visible = false
  let currentTimeMs = Number.isFinite(Number(initialTimeMs))
    ? Number(initialTimeMs)
    : Date.now()
  let lastFetchMs = 0
  let fetchIntervalId = null
  let loadPromise = null

  const requestRender = () => {
    try {
      if (!viewer.isDestroyed()) {
        viewer.scene.requestRender()
      }
    } catch {
      // No-op during teardown.
    }
  }

  const clearHexEntities = () => {
    hexEntries.forEach((entry) => {
      dataSource.entities.remove(entry.entity)
    })
    hexEntries.clear()
  }

  const createHexEntity = (hexData) => {
    try {
      // H3 returns hex indices. We need to convert them to polygon coordinates.
      // cellToBoundary returns an array of [lat, lon] pairs.
      const boundary = cellToBoundary(hexData.hex)

      // Convert to Cesium Cartesian coordinates.
      // Boundary is [[lat, lon], ...] - need to convert to [lon, lat, altitude]
      const positions = boundary.map(([lat, lon]) => {
        return Cesium.Cartesian3.fromDegrees(lon, lat, 0)
      })

      const color = getJammingColor(hexData.jammingRatio)
      const fillColor = Cesium.Color.fromCssColorString(
        `rgba(${color.red}, ${color.green}, ${color.blue}, ${color.alpha})`
      )
      const outlineColor = fillColor.withAlpha(0.9)

      const entity = dataSource.entities.add({
        id: `gps-jamming-${hexData.hex}`,
        polygon: {
          hierarchy: new Cesium.PolygonHierarchy(positions),
          material: fillColor,
          outline: true,
          outlineColor: outlineColor,
          outlineWidth: 1,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        properties: {
          layerType: 'gps-jamming',
          hex: hexData.hex,
          jammingRatio: hexData.jammingRatio,
          totalAircraft: hexData.totalAircraft,
        },
      })

      hexEntries.set(hexData.hex, { entity, hex: hexData.hex })
      return entity
    } catch (error) {
      // Some H3 indices may fail to parse - skip them silently.
      console.warn(`Failed to render H3 hex: ${hexData.hex}`, error)
      return null
    }
  }

  const refreshJammingData = async ({ force = false } = {}) => {
    if (!visible || destroyed) {
      return
    }

    const nowMs = Date.now()

    if (!force && lastFetchMs && nowMs - lastFetchMs < REFRESH_INTERVAL_MS) {
      return
    }

    if (!loadPromise) {
      loadPromise = fetchGpsJammingData(currentTimeMs)
        .then((response) => {
          if (destroyed) {
            return
          }

          const data = response.data || []

          // Remove hexes that are no longer in the data
          const newHexSet = new Set(data.map((d) => d.hex))
          hexEntries.forEach((entry, hexKey) => {
            if (!newHexSet.has(hexKey)) {
              dataSource.entities.remove(entry.entity)
              hexEntries.delete(hexKey)
            }
          })

          // Update or create hex entities
          data.forEach((hexData) => {
            const existingEntry = hexEntries.get(hexData.hex)

            if (existingEntry) {
              // Update color if jamming ratio changed
              const existingRatio = existingEntry.entity.properties?.jammingRatio?.getValue(Cesium.JulianDate.now())
              if (existingRatio !== hexData.jammingRatio) {
                dataSource.entities.remove(existingEntry.entity)
                hexEntries.delete(hexData.hex)
                createHexEntity(hexData)
              } else {
                // Update properties in place
                existingEntry.entity.properties.jammingRatio = new Cesium.ConstantProperty(hexData.jammingRatio)
                existingEntry.entity.properties.totalAircraft = new Cesium.ConstantProperty(hexData.totalAircraft)
              }
            } else {
              createHexEntity(hexData)
            }
          })

          lastFetchMs = Date.now()

          if (onStatusChange) {
            onStatusChange({
              configured: true,
              source: response.source || 'gpsjam.org',
              hexCount: data.length,
              error: '',
            })
          }

          requestRender()
        })
        .catch((error) => {
          console.error('Unable to fetch GPS jamming data.', error)

          if (onStatusChange) {
            onStatusChange({
              configured: false,
              source: 'gpsjam.org',
              hexCount: 0,
              error: error.message,
            })
          }
        })
        .finally(() => {
          loadPromise = null
        })
    }

    await loadPromise
  }

  const attachDataSource = async () => {
    if (attached || destroyed) {
      return
    }

    attached = true
    await viewer.dataSources.add(dataSource)
  }

  const detachDataSource = () => {
    if (!attached) {
      return
    }

    attached = false
    viewer.dataSources.remove(dataSource, false)
  }

  return {
    async show() {
      if (destroyed) {
        return
      }

      visible = true
      await attachDataSource()

      if (destroyed) {
        detachDataSource()
        return
      }

      await refreshJammingData({ force: true })
    },

    hide() {
      visible = false
      detachDataSource()
    },

    setTime(nextTimeMs) {
      const parsedTimeMs = Number(nextTimeMs)

      if (!Number.isFinite(parsedTimeMs)) {
        return
      }

      currentTimeMs = parsedTimeMs
    },

    async refresh() {
      if (!visible) {
        await this.show()
        return
      }

      await refreshJammingData({ force: true })
    },

    getDataSource() {
      return dataSource
    },

    destroy() {
      destroyed = true
      visible = false
      clearHexEntities()

      if (fetchIntervalId) {
        window.clearInterval(fetchIntervalId)
        fetchIntervalId = null
      }

      if (attached) {
        detachDataSource()
      }
    },
  }
}