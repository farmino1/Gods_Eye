import * as Cesium from 'cesium'

export const ARCGIS_WORLD_IMAGERY_URL =
  'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer'
const ARCGIS_WORLD_REFERENCE_URL =
  'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer'
export const REFERENCE_OVERLAY_ORDER = 300
export const ROAD_OVERLAY_ORDER = 200

function requestRender(viewer) {
  try {
    if (!viewer.isDestroyed()) {
      viewer.scene.requestRender()
    }
  } catch {
    // No-op during teardown.
  }
}

export function restackManagedImageryLayers(viewer) {
  const imageryLayers = viewer?.imageryLayers

  if (!imageryLayers) {
    return
  }

  const layers = []

  for (let index = 0; index < imageryLayers.length; index += 1) {
    layers.push(imageryLayers.get(index))
  }

  const managedLayers = layers
    .filter((layer) => Number.isFinite(layer?.__palantirOrder))
    .sort((leftLayer, rightLayer) => leftLayer.__palantirOrder - rightLayer.__palantirOrder)

  managedLayers.forEach((layer) => {
    imageryLayers.raiseToTop(layer)
  })
}

async function createArcGisProvider(url) {
  return Cesium.ArcGisMapServerImageryProvider.fromUrl(url, {
    enablePickFeatures: false,
  })
}

export async function configureReferenceMap(viewer) {
  const [imageryResult, referenceResult] = await Promise.allSettled([
    createArcGisProvider(ARCGIS_WORLD_IMAGERY_URL),
    createArcGisProvider(ARCGIS_WORLD_REFERENCE_URL),
  ])
  const imageryProvider =
    imageryResult.status === 'fulfilled' ? imageryResult.value : null
  const referenceProvider =
    referenceResult.status === 'fulfilled' ? referenceResult.value : null

  if (!imageryProvider && !referenceProvider) {
    throw new Error('Unable to load ArcGIS world imagery or reference labels.')
  }

  if (imageryProvider) {
    viewer.imageryLayers.removeAll()
    viewer.imageryLayers.add(new Cesium.ImageryLayer(imageryProvider))
  }

  if (referenceProvider) {
    const referenceLayer = viewer.imageryLayers.add(
      new Cesium.ImageryLayer(referenceProvider, {
        alpha: 0.96,
      }),
    )

    if (referenceLayer) {
      referenceLayer.__palantirOrder = REFERENCE_OVERLAY_ORDER
    }
  }

  restackManagedImageryLayers(viewer)
  requestRender(viewer)
}
