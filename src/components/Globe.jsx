import { useEffect, useRef, useState } from 'react'
import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { createAircraftLayer } from '../layers/aircraft'
import { createBuildingLayer } from '../layers/buildings'
import CameraPopup from './CameraPopup'
import { createCameraLayer } from '../layers/cameras'
import { createGpsJammingLayer } from '../layers/gpsJamming'
import LocationSearchBar from './LocationSearchBar'
import { configureReferenceMap } from '../layers/referenceMap'
import { createShipLayer } from '../layers/ships'
import { createSatelliteLayer } from '../layers/satellites'
import useTimeStore from '../store/timeStore'
import useStore from '../store/useStore'

const CESIUM_ION_TOKEN =
  typeof import.meta.env?.VITE_CESIUM_ION_TOKEN === 'string'
    ? import.meta.env.VITE_CESIUM_ION_TOKEN.trim()
    : ''

// Explicitly disable Cesium's built-in demo token so the warning credit never
// appears when this repo is run without local ion credentials.
Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN || ''

// Globe is the frontend composition root for Cesium. It owns viewer creation,
// layer lifecycles, pick handling, and the bridge between global store state
// and imperative layer controllers.
const INITIAL_VIEW = {
  longitude: 12,
  latitude: 48,
  height: 20_000_000,
}

async function createTerrainProvider() {
  if (CESIUM_ION_TOKEN && typeof Cesium.createWorldTerrainAsync === 'function') {
    return {
      terrainProvider: await Cesium.createWorldTerrainAsync(),
    }
  }

  if (
    CESIUM_ION_TOKEN &&
    Cesium.Terrain &&
    typeof Cesium.Terrain.fromWorldTerrain === 'function'
  ) {
    return {
      terrain: Cesium.Terrain.fromWorldTerrain(),
    }
  }

  return {
    terrainProvider: new Cesium.EllipsoidTerrainProvider(),
  }
}

function resolveFocusTarget(selectedItem, layerRefs) {
  if (!selectedItem) {
    return null
  }

  switch (selectedItem.type) {
    case 'aircraft':
      return layerRefs.aircraft?.getFocusTarget?.() ?? null
    case 'camera':
      return layerRefs.camera?.getFocusTarget?.() ?? null
    case 'ship':
      return layerRefs.ship?.getFocusTarget?.() ?? null
    default:
      return null
  }
}

function Globe() {
  const satellitesEnabled = useStore((state) => state.layers.satellites)
  const aircraftEnabled = useStore((state) => state.layers.aircraft)
  const camerasEnabled = useStore((state) => state.layers.cameras)
  
  const buildingsEnabled = useStore((state) => state.layers.buildings)
  const shipsEnabled = useStore((state) => state.layers.ships)
  const gpsJammingEnabled = useStore((state) => state.layers.gpsJamming)
  
  const satelliteLimit = useStore((state) => state.satelliteLimit)
  const currentTime = useTimeStore((state) => state.currentTime)
  const setSatelliteCatalogCounts = useStore(
    (state) => state.setSatelliteCatalogCounts,
  )
  const selectedItem = useStore((state) => state.selectedItem)
  const setSelectedItem = useStore((state) => state.setSelectedItem)
  const clearSelectedItem = useStore((state) => state.clearSelectedItem)

  const containerRef = useRef(null)
  const viewerRef = useRef(null)
  const satelliteLayerRef = useRef(null)
  const aircraftLayerRef = useRef(null)
  const cameraLayerRef = useRef(null)
  const buildingLayerRef = useRef(null)
  
  const shipLayerRef = useRef(null)
  const gpsJammingLayerRef = useRef(null)
  const initialTimeRef = useRef(currentTime)
  const initialSatelliteLimitRef = useRef(satelliteLimit)
  const defaultCameraZoomLimitsRef = useRef(null)
  const activeFocusKeyRef = useRef('')
  const [status, setStatus] = useState('loading')
  const [viewerReady, setViewerReady] = useState(false)
  const [viewerInstance, setViewerInstance] = useState(null)

  useEffect(() => {
    let cancelled = false

    const initializeViewer = async () => {
      if (!containerRef.current || viewerRef.current) {
        return
      }

      try {
        const terrainOptions = await createTerrainProvider()

        if (cancelled || !containerRef.current) {
          return
        }

        const viewer = new Cesium.Viewer(containerRef.current, {
          ...terrainOptions,
          animation: false,
          timeline: false,
          baseLayerPicker: false,
          fullscreenButton: false,
          geocoder: false,
          homeButton: false,
          infoBox: false,
          navigationHelpButton: false,
          sceneModePicker: false,
          selectionIndicator: false,
        })

        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(
            INITIAL_VIEW.longitude,
            INITIAL_VIEW.latitude,
            INITIAL_VIEW.height,
          ),
        })

        viewer.scene.globe.enableLighting = true
        viewer.scene.globe.depthTestAgainstTerrain = true
        viewer.scene.requestRenderMode = true
        viewer.scene.maximumRenderTimeChange = Infinity
        viewer.scene.screenSpaceCameraController.inertiaSpin = 0.85
        viewer.scene.screenSpaceCameraController.inertiaTranslate = 0.85
        viewer.scene.screenSpaceCameraController.inertiaZoom = 0.7
        await configureReferenceMap(viewer).catch((error) => {
          console.error('Unable to load the ArcGIS reference map.', error)
        })

        viewerRef.current = viewer
        setViewerInstance(viewer)
        setViewerReady(true)
        setStatus('ready')
      } catch (error) {
        if (cancelled || !containerRef.current) {
          return
        }

        const viewer = new Cesium.Viewer(containerRef.current, {
          terrainProvider: new Cesium.EllipsoidTerrainProvider(),
          animation: false,
          timeline: false,
          baseLayerPicker: false,
          fullscreenButton: false,
          geocoder: false,
          homeButton: false,
          infoBox: false,
          navigationHelpButton: false,
          sceneModePicker: false,
          selectionIndicator: false,
        })

        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(
            INITIAL_VIEW.longitude,
            INITIAL_VIEW.latitude,
            INITIAL_VIEW.height,
          ),
        })

        viewer.scene.globe.enableLighting = true
        viewer.scene.globe.depthTestAgainstTerrain = true
        viewer.scene.requestRenderMode = true
        viewer.scene.maximumRenderTimeChange = Infinity
        await configureReferenceMap(viewer).catch((error) => {
          console.error('Unable to load the ArcGIS reference map.', error)
        })
        viewerRef.current = viewer
        setViewerInstance(viewer)
        setViewerReady(true)
        setStatus('fallback')
        console.error('Unable to load Cesium world terrain, using default globe.', error)
      }
    }

    initializeViewer()

    return () => {
      cancelled = true

      if (satelliteLayerRef.current) {
        satelliteLayerRef.current.destroy()
        satelliteLayerRef.current = null
      }

      if (aircraftLayerRef.current) {
        aircraftLayerRef.current.destroy()
        aircraftLayerRef.current = null
      }

      if (cameraLayerRef.current) {
        cameraLayerRef.current.destroy()
        cameraLayerRef.current = null
      }

      

      if (buildingLayerRef.current) {
        buildingLayerRef.current.destroy()
        buildingLayerRef.current = null
      }

      if (shipLayerRef.current) {
        shipLayerRef.current.destroy()
        shipLayerRef.current = null
      }

      if (gpsJammingLayerRef.current) {
        gpsJammingLayerRef.current.destroy()
        gpsJammingLayerRef.current = null
      }

      if (viewerRef.current && !viewerRef.current.isDestroyed()) {
        viewerRef.current.destroy()
      }

      viewerRef.current = null
      setViewerInstance(null)
    }
  }, [])

  useEffect(() => {
    const viewer = viewerRef.current

    if (!viewerReady || !viewer || satelliteLayerRef.current) {
      return
    }

    // Every layer is constructed once and then driven imperatively via refs.
    // That keeps Cesium resources stable even as React state changes frequently.
    const satelliteLayer = createSatelliteLayer({
      viewer,
      maxSatellites: initialSatelliteLimitRef.current,
      initialTimeMs: initialTimeRef.current,
      onCatalogChange: setSatelliteCatalogCounts,
      onSelectionChange: (selectedItem) => {
        if (selectedItem) {
          setSelectedItem(selectedItem)
          return
        }

        if (useStore.getState().selectedItem?.type === 'satellite') {
          clearSelectedItem()
        }
      },
    })

    const aircraftLayer = createAircraftLayer({
      viewer,
      initialTimeMs: initialTimeRef.current,
      onSelectionChange: (selectedItem) => {
        if (selectedItem) {
          setSelectedItem(selectedItem)
          return
        }

        if (useStore.getState().selectedItem?.type === 'aircraft') {
          clearSelectedItem()
        }
      },
    })
    const cameraLayer = createCameraLayer({
      viewer,
      onSelectionChange: (selectedItem) => {
        if (selectedItem) {
          setSelectedItem(selectedItem)
          return
        }

        if (useStore.getState().selectedItem?.type === 'camera') {
          clearSelectedItem()
        }
      },
    })

    
    const buildingLayer = createBuildingLayer({
      viewer,
    })
    const shipLayer = createShipLayer({
      viewer,
      initialTimeMs: initialTimeRef.current,
      onSelectionChange: (selectedItem) => {
        if (selectedItem) {
          setSelectedItem(selectedItem)
          return
        }

        if (useStore.getState().selectedItem?.type === 'ship') {
          clearSelectedItem()
        }
      },
    })
    const gpsJammingLayer = createGpsJammingLayer({
      viewer,
      initialTimeMs: initialTimeRef.current,
    })
    const screenSpaceEventHandler = viewer.screenSpaceEventHandler

    const onLeftClick = (movement) => {
      const pickedObject = viewer.scene.pick(movement.position)

      // Pick priority is deliberate: aircraft and ships are usually much denser
      // than satellite helpers, so we resolve the more local layers first.
      const aircraftHandled = aircraftLayer.handlePick(pickedObject)

      if (aircraftHandled) {
        cameraLayer.clearSelection()
        shipLayer.clearSelection()
        satelliteLayer.clearSelection()
        return
      }

      const shipHandled = shipLayer.handlePick(pickedObject)

      if (shipHandled) {
        aircraftLayer.clearSelection()
        cameraLayer.clearSelection()
        satelliteLayer.clearSelection()
        return
      }

      const cameraHandled = cameraLayer.handlePick(pickedObject)

      if (cameraHandled) {
        aircraftLayer.clearSelection()
        shipLayer.clearSelection()
        satelliteLayer.clearSelection()
        return
      }

      const satelliteHandled = satelliteLayer.handlePick(pickedObject)

      if (satelliteHandled) {
        aircraftLayer.clearSelection()
        cameraLayer.clearSelection()
        shipLayer.clearSelection()
        return
      }

      aircraftLayer.clearSelection()
      cameraLayer.clearSelection()
      shipLayer.clearSelection()
      satelliteLayer.clearSelection()
    }

    satelliteLayerRef.current = satelliteLayer
    aircraftLayerRef.current = aircraftLayer
    cameraLayerRef.current = cameraLayer
    buildingLayerRef.current = buildingLayer
    
    shipLayerRef.current = shipLayer
    gpsJammingLayerRef.current = gpsJammingLayer
    screenSpaceEventHandler.setInputAction(
      onLeftClick,
      Cesium.ScreenSpaceEventType.LEFT_CLICK,
    )

    return () => {
      if (screenSpaceEventHandler && !viewer.isDestroyed()) {
        screenSpaceEventHandler.removeInputAction(
          Cesium.ScreenSpaceEventType.LEFT_CLICK,
        )
      }

      aircraftLayer.destroy()
      aircraftLayerRef.current = null
      cameraLayer.destroy()
      cameraLayerRef.current = null
      buildingLayer.destroy()
      buildingLayerRef.current = null
      shipLayer.destroy()
      shipLayerRef.current = null
      gpsJammingLayer.destroy()
      gpsJammingLayerRef.current = null
      satelliteLayer.destroy()
      satelliteLayerRef.current = null
      
    }
  }, [
    viewerReady,
    setSelectedItem,
    clearSelectedItem,
    setSatelliteCatalogCounts,
  ])

  useEffect(() => {
    if (!viewerReady || !viewerRef.current) {
      return
    }

    const viewer = viewerRef.current

    if (viewer.isDestroyed()) {
      return
    }

    const controller = viewer.scene.screenSpaceCameraController

    if (!defaultCameraZoomLimitsRef.current) {
      defaultCameraZoomLimitsRef.current = {
        minimumZoomDistance: controller.minimumZoomDistance,
        maximumZoomDistance: controller.maximumZoomDistance,
      }
    }

    const focusTarget = resolveFocusTarget(selectedItem, {
      aircraft: aircraftLayerRef.current,
      camera: cameraLayerRef.current,
      ship: shipLayerRef.current,
    })

    if (!focusTarget?.entity || !focusTarget?.focus) {
      activeFocusKeyRef.current = ''
      viewer.trackedEntity = undefined

      if (defaultCameraZoomLimitsRef.current) {
        controller.minimumZoomDistance =
          defaultCameraZoomLimitsRef.current.minimumZoomDistance
        controller.maximumZoomDistance =
          defaultCameraZoomLimitsRef.current.maximumZoomDistance
      }

      viewer.scene.requestRender()
      return
    }

    controller.minimumZoomDistance = focusTarget.focus.minimumZoomDistance
    controller.maximumZoomDistance = focusTarget.focus.maximumZoomDistance
    viewer.trackedEntity = focusTarget.entity

    const nextFocusKey = `${selectedItem.type}:${selectedItem.id}`

    if (activeFocusKeyRef.current === nextFocusKey) {
      viewer.scene.requestRender()
      return
    }

    activeFocusKeyRef.current = nextFocusKey
    viewer
      .zoomTo(
        focusTarget.entity,
        new Cesium.HeadingPitchRange(
          0,
          Cesium.Math.toRadians(
            focusTarget.focus.defaultPitchDegrees ?? -18,
          ),
          focusTarget.focus.defaultZoomDistance,
        ),
      )
      .catch((error) => {
        console.error('Unable to focus the selected object.', error)
      })
  }, [selectedItem, viewerReady])

  useEffect(() => {
    if (!viewerReady || !satelliteLayerRef.current) {
      return
    }

    const syncSatelliteLayer = async () => {
      if (satellitesEnabled) {
        await satelliteLayerRef.current.show()
        return
      }

      satelliteLayerRef.current.hide()
    }

    syncSatelliteLayer().catch((error) => {
      console.error('Unable to sync satellite layer visibility.', error)
    })
  }, [satellitesEnabled, viewerReady])

  useEffect(() => {
    if (!viewerReady || !aircraftLayerRef.current) {
      return
    }

    const syncAircraftLayer = async () => {
      if (aircraftEnabled) {
        await aircraftLayerRef.current.show()
        return
      }

      aircraftLayerRef.current.hide()
    }

    syncAircraftLayer().catch((error) => {
      console.error('Unable to sync aircraft layer visibility.', error)
    })
  }, [aircraftEnabled, viewerReady])

  useEffect(() => {
    if (!viewerReady || !cameraLayerRef.current) {
      return
    }

    const syncCameraLayer = async () => {
      if (camerasEnabled) {
        await cameraLayerRef.current.show()
        return
      }

      cameraLayerRef.current.hide()
    }

    syncCameraLayer().catch((error) => {
      console.error('Unable to sync camera layer visibility.', error)
    })
  }, [camerasEnabled, viewerReady])

  useEffect(() => {
    if (!viewerReady || !buildingLayerRef.current) {
      return
    }

    const syncBuildingLayer = async () => {
      if (buildingsEnabled) {
        await buildingLayerRef.current.show()
        return
      }

      buildingLayerRef.current.hide()
    }

    syncBuildingLayer().catch((error) => {
      console.error('Unable to sync building layer visibility.', error)
    })
  }, [buildingsEnabled, viewerReady])

  useEffect(() => {
    if (!viewerReady || !shipLayerRef.current) {
      return
    }

    const syncShipLayer = async () => {
      if (shipsEnabled) {
        await shipLayerRef.current.show()
        return
      }

      shipLayerRef.current.hide()
    }

    syncShipLayer().catch((error) => {
      console.error('Unable to sync ship layer visibility.', error)
    })
  }, [shipsEnabled, viewerReady])

  useEffect(() => {
    if (!viewerReady || !gpsJammingLayerRef.current) {
      return
    }

    const syncGpsJammingLayer = async () => {
      if (gpsJammingEnabled) {
        await gpsJammingLayerRef.current.show()
        return
      }

      gpsJammingLayerRef.current.hide()
    }

    syncGpsJammingLayer().catch((error) => {
      console.error('Unable to sync GPS jamming layer visibility.', error)
    })
  }, [gpsJammingEnabled, viewerReady])

  

  useEffect(() => {
    if (!viewerReady || !satelliteLayerRef.current) {
      return
    }

    satelliteLayerRef.current
      .setDisplayLimits({
        satelliteLimit,
      })
      .catch((error) => {
        console.error('Unable to update the satellite caps.', error)
      })
  }, [satelliteLimit, viewerReady])

  useEffect(() => {
    if (!viewerReady) {
      return
    }

    // Time changes are pushed into each layer controller so every layer can
    // decide for itself whether the new timestamp means live updates, replay,
    // or a bucketed data refresh.
    satelliteLayerRef.current?.setTime(currentTime)
    aircraftLayerRef.current?.setTime(currentTime)
    shipLayerRef.current?.setTime(currentTime)
    gpsJammingLayerRef.current?.setTime(currentTime)
  }, [currentTime, viewerReady])

  const handleBeforeFlyToLocation = () => {
    const viewer = viewerRef.current

    if (viewer && !viewer.isDestroyed()) {
      viewer.trackedEntity = undefined
    }

    aircraftLayerRef.current?.clearSelection?.()
    cameraLayerRef.current?.clearSelection?.()
    shipLayerRef.current?.clearSelection?.()
    gpsJammingLayerRef.current?.clearSelection?.()
    satelliteLayerRef.current?.clearSelection?.()
    clearSelectedItem()
  }

  return (
    <div className="cesium-shell relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />

      {viewerInstance && (
        <LocationSearchBar
          viewer={viewerInstance}
          onBeforeFlyToResult={handleBeforeFlyToLocation}
        />
      )}

      {status === 'loading' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/30 text-sm text-slate-200">
          Initializing globe...
        </div>
      )}

      {status === 'fallback' && (
        <div className="pointer-events-none absolute bottom-6 left-6 rounded-xl border border-amber-400/20 bg-slate-950/70 px-4 py-2 text-sm text-amber-200 backdrop-blur-md">
          Terrain is unavailable right now, but the globe is still interactive.
        </div>
      )}

      <CameraPopup
        camera={selectedItem?.type === 'camera' ? selectedItem : null}
        onClose={() => {
          cameraLayerRef.current?.clearSelection?.()
          clearSelectedItem()
        }}
      />
    </div>
  )
}

export default Globe
