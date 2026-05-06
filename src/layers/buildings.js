import * as Cesium from 'cesium'
import { getBboxSpans } from '../utils/geo.js'
import { getHorizonAwareViewRectangleDegrees } from '../utils/cameraViewport.js'

const MAX_BUILDING_CAMERA_HEIGHT_METERS = 6_000
const MAX_BUILDING_LATITUDE_SPAN_DEGREES = 0.035
const MAX_BUILDING_LONGITUDE_SPAN_DEGREES = 0.05
const BUILDING_HORIZON_MAX_CAMERA_HEIGHT_METERS = 3_000
const BUILDING_HORIZON_MIN_PITCH_DEGREES = -20
const BUILDING_HORIZON_MAX_PITCH_DEGREES = 16
const BUILDING_HORIZON_MIN_HALF_DISTANCE_METERS = 1_200
const BUILDING_HORIZON_MAX_HALF_DISTANCE_METERS = 1_700
const BUILDING_HORIZON_HEIGHT_MULTIPLIER = 1.25

function toTrimmedString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() || fallback : fallback
}

export function resolveBuildingLayerConfig(env = {}) {
  return {
    cesiumIonToken: toTrimmedString(env?.VITE_CESIUM_ION_TOKEN),
  }
}

const BUILDING_LAYER_CONFIG = resolveBuildingLayerConfig(import.meta.env ?? {})

// Quick-win tuning for visibility toggles and tileset loading
const VISIBILITY_HIDE_DEBOUNCE_MS = 700
const VISIBILITY_MIN_TOGGLE_MS = 1000
const LOAD_STABILITY_MS = 600
const TILES_MAX_SCREEN_SPACE_ERROR = 32

function requestRender(viewer) {
  try {
    if (!viewer.isDestroyed()) {
      viewer.scene.requestRender()
    }
  } catch {
    // No-op during teardown.
  }
}

function getViewRectangleDegrees(viewer) {
  return getHorizonAwareViewRectangleDegrees(viewer, {
    maximumCameraHeightMeters: BUILDING_HORIZON_MAX_CAMERA_HEIGHT_METERS,
    minimumPitchDegrees: BUILDING_HORIZON_MIN_PITCH_DEGREES,
    maximumPitchDegrees: BUILDING_HORIZON_MAX_PITCH_DEGREES,
    minLocalHalfDistanceMeters: BUILDING_HORIZON_MIN_HALF_DISTANCE_METERS,
    maxLocalHalfDistanceMeters: BUILDING_HORIZON_MAX_HALF_DISTANCE_METERS,
    localDistanceHeightMultiplier: BUILDING_HORIZON_HEIGHT_MULTIPLIER,
  })
}

export function shouldRenderBuildingsView({
  viewRectangle,
  cameraHeightMeters,
} = {}) {
  if (!viewRectangle) {
    return false
  }

  const spans = getBboxSpans(viewRectangle)

  if (
    Number.isFinite(cameraHeightMeters) &&
    cameraHeightMeters > MAX_BUILDING_CAMERA_HEIGHT_METERS
  ) {
    return false
  }

  return (
    spans.latitudeSpan <= MAX_BUILDING_LATITUDE_SPAN_DEGREES &&
    spans.longitudeSpan <= MAX_BUILDING_LONGITUDE_SPAN_DEGREES
  )
}

function shouldShowPhotorealisticBuildings(viewer) {
  return shouldRenderBuildingsView({
    viewRectangle: getViewRectangleDegrees(viewer),
    cameraHeightMeters: Number(viewer?.camera?.positionCartographic?.height),
  })
}

export function createBuildingLayer({ viewer } = {}) {
  let destroyed = false
  let visible = false
  let texturedTileset = null
  let texturedTilesetPromise = null
  let texturedTilesetFailed = false
  let removeCameraChangedListener = null
  let removeCameraMoveEndListener = null
  let visibilityFrameId = null
  let queuedAllowLoad = false
  let loadStabilityTimeoutId = null
  let hideTimeoutId = null
  let lastShowHideActionMs = 0

  function applyBuildingProviderCredentials() {
    Cesium.Ion.defaultAccessToken = BUILDING_LAYER_CONFIG.cesiumIonToken || ''
  }

  async function ensureTexturedTileset() {
    if (texturedTilesetFailed) {
      return null
    }

    if (texturedTileset) {
      return texturedTileset
    }

    if (!texturedTilesetPromise) {
      texturedTilesetPromise = (async () => {
        if (!BUILDING_LAYER_CONFIG.cesiumIonToken) {
          texturedTilesetFailed = true
          return null
        }

        applyBuildingProviderCredentials()

        const nextTileset = await Cesium.createGooglePhotorealistic3DTileset({})

        if (destroyed || viewer.isDestroyed?.()) {
          nextTileset.destroy?.()
          return null
        }

        // Conservative LOD caps to avoid immediate high-res texture loads
        // that can cause jank on lower-end GPUs. These settings reduce
        // quality in exchange for fewer textures/tiles being loaded.
        try {
          if (typeof nextTileset.maximumScreenSpaceError === 'number') {
            nextTileset.maximumScreenSpaceError = TILES_MAX_SCREEN_SPACE_ERROR
          }

          if ('immediatelyLoadDesiredLevelOfDetail' in nextTileset) {
            nextTileset.immediatelyLoadDesiredLevelOfDetail = false
          }
        } catch (e) {
          // defensive: some tileset implementations may not expose these
        }

        nextTileset.show = false
        viewer.scene.primitives.add(nextTileset)
        texturedTileset = nextTileset
        return nextTileset
      })()
        .catch((error) => {
          texturedTilesetFailed = true
          console.warn(
            'Unable to load Cesium photorealistic buildings. The Buildings layer will stay hidden.',
            error,
          )
          return null
        })
        .finally(() => {
          texturedTilesetPromise = null
        })
    }

    return texturedTilesetPromise
  }

  function showTexturedTileset() {
    const now = Date.now()

    if (!texturedTileset || texturedTileset.show) {
      return
    }

    // Avoid rapid toggles
    if (now - lastShowHideActionMs < VISIBILITY_MIN_TOGGLE_MS) {
      return
    }

    lastShowHideActionMs = now
    if (hideTimeoutId) {
      window.clearTimeout(hideTimeoutId)
      hideTimeoutId = null
    }

    texturedTileset.show = true
    requestRender(viewer)
  }

  function hideTexturedTileset() {
    if (!texturedTileset || !texturedTileset.show) {
      return
    }

    // Debounce hiding so quick camera pans don't thrash the tileset
    if (hideTimeoutId) {
      window.clearTimeout(hideTimeoutId)
    }

    hideTimeoutId = window.setTimeout(() => {
      const now = Date.now()

      if (now - lastShowHideActionMs < VISIBILITY_MIN_TOGGLE_MS) {
        hideTimeoutId = null
        return
      }

      lastShowHideActionMs = now
      if (texturedTileset) {
        texturedTileset.show = false
        requestRender(viewer)
      }

      hideTimeoutId = null
    }, VISIBILITY_HIDE_DEBOUNCE_MS)
  }

  async function syncBuildingVisibility({ allowLoad = false } = {}) {
    if (destroyed || !visible) {
      return
    }

    if (!shouldShowPhotorealisticBuildings(viewer)) {
      hideTexturedTileset()
      return
    }

    const nextTileset = allowLoad ? await ensureTexturedTileset() : texturedTileset

    if (destroyed || !visible) {
      return
    }

    if (!shouldShowPhotorealisticBuildings(viewer)) {
      hideTexturedTileset()
      return
    }

    if (nextTileset) {
      showTexturedTileset()
    }
  }

  function clearQueuedVisibilitySync() {
    if (visibilityFrameId !== null) {
      window.cancelAnimationFrame(visibilityFrameId)
      visibilityFrameId = null
    }

    queuedAllowLoad = false

    if (loadStabilityTimeoutId !== null) {
      window.clearTimeout(loadStabilityTimeoutId)
      loadStabilityTimeoutId = null
    }

    if (hideTimeoutId !== null) {
      window.clearTimeout(hideTimeoutId)
      hideTimeoutId = null
    }
  }

  function queueVisibilitySync({ allowLoad = false } = {}) {
    queuedAllowLoad = queuedAllowLoad || allowLoad

    if (visibilityFrameId !== null || destroyed) {
      return
    }

    if (queuedAllowLoad) {
      // If we are allowed to load tiles (moveEnd), wait for a short
      // stability window before starting heavy tile loads. This avoids
      // repeatedly starting loads while the user is still moving the map.
      if (loadStabilityTimeoutId !== null) {
        return
      }

      loadStabilityTimeoutId = window.setTimeout(() => {
        loadStabilityTimeoutId = null
        visibilityFrameId = window.requestAnimationFrame(() => {
          const nextAllowLoad = queuedAllowLoad
          visibilityFrameId = null
          queuedAllowLoad = false
          syncBuildingVisibility({
            allowLoad: nextAllowLoad,
          }).catch((error) => {
            console.error('Unable to sync the 3D building layer.', error)
          })
        })
      }, LOAD_STABILITY_MS)

      return
    }

    visibilityFrameId = window.requestAnimationFrame(() => {
      const nextAllowLoad = queuedAllowLoad
      visibilityFrameId = null
      queuedAllowLoad = false
      syncBuildingVisibility({
        allowLoad: nextAllowLoad,
      }).catch((error) => {
        console.error('Unable to sync the 3D building layer.', error)
      })
    })
  }

  function attachCameraListeners() {
    if (removeCameraChangedListener || removeCameraMoveEndListener || destroyed) {
      return
    }

    removeCameraChangedListener = viewer.camera.changed.addEventListener(() => {
      if (!visible) {
        return
      }

      if (!shouldShowPhotorealisticBuildings(viewer)) {
        hideTexturedTileset()
        return
      }

      queueVisibilitySync({
        allowLoad: false,
      })
    })
    removeCameraMoveEndListener = viewer.camera.moveEnd.addEventListener(() => {
      queueVisibilitySync({
        allowLoad: true,
      })
    })
  }

  function detachCameraListeners() {
    clearQueuedVisibilitySync()

    if (removeCameraChangedListener) {
      removeCameraChangedListener()
      removeCameraChangedListener = null
    }

    if (removeCameraMoveEndListener) {
      removeCameraMoveEndListener()
      removeCameraMoveEndListener = null
    }
  }

  return {
    async show() {
      if (destroyed) {
        return
      }

      visible = true
      attachCameraListeners()
      await syncBuildingVisibility({
        allowLoad: true,
      })
    },

    hide() {
      visible = false
      detachCameraListeners()
      hideTexturedTileset()
    },

    destroy() {
      destroyed = true
      this.hide()

      if (texturedTileset) {
        try {
          viewer.scene.primitives.remove(texturedTileset)
        } catch {
          // Ignore stale primitives during teardown.
        }

        texturedTileset = null
      }
    },
  }
}
