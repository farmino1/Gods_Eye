import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export const DEFAULT_SATELLITE_LIMIT = 100

function normalizeCount(
  value,
  { fallback = DEFAULT_SATELLITE_LIMIT, minimum = 0 } = {},
) {
  const parsedValue = Number(value)

  if (!Number.isFinite(parsedValue)) {
    return fallback
  }

  return Math.max(minimum, Math.floor(parsedValue))
}

const defaultLayers = {
  satellites: true,
  aircraft: true,
  cameras: false,
  buildings: true,
  ships: false,
  gpsJamming: false,
}

const layerSelectionTypes = {
  satellites: 'satellite',
  aircraft: 'aircraft',
  cameras: 'camera',
  ships: 'ship',
}

const useStore = create(
  persist(
    (set) => ({
      satelliteLimit: DEFAULT_SATELLITE_LIMIT,
      satelliteTotal: DEFAULT_SATELLITE_LIMIT,
      militarySatelliteTotal: 0,
      selectedItem: null,
      layers: defaultLayers,
      toggleLayer: (layerKey) =>
        set((state) => ({
          layers: {
            ...state.layers,
            [layerKey]: !state.layers[layerKey],
          },
          selectedItem:
            state.layers[layerKey] &&
            state.selectedItem?.type === layerSelectionTypes[layerKey]
              ? null
              : state.selectedItem,
        })),
      setSatelliteLimit: (satelliteLimit) =>
        set((state) => ({
          satelliteLimit: Math.min(
            normalizeCount(satelliteLimit, { minimum: 1 }),
            state.satelliteTotal,
          ),
        })),
      setSatelliteCatalogCounts: ({
        satelliteTotal,
        militarySatelliteTotal,
      }) =>
        set((state) => {
          const nextSatelliteTotal = normalizeCount(satelliteTotal, {
            fallback: DEFAULT_SATELLITE_LIMIT,
            minimum: 1,
          })
          const nextMilitarySatelliteTotal = Math.min(
            normalizeCount(militarySatelliteTotal, {
              fallback: 0,
            }),
            nextSatelliteTotal,
          )
          const nextSatelliteLimit = Math.min(
            Math.max(1, state.satelliteLimit),
            nextSatelliteTotal,
          )

          return {
            satelliteTotal: nextSatelliteTotal,
            militarySatelliteTotal: nextMilitarySatelliteTotal,
            satelliteLimit: nextSatelliteLimit,
          }
        }),
      setSelectedItem: (selectedItem) => set(() => ({ selectedItem })),
      clearSelectedItem: () => set(() => ({ selectedItem: null })),
    }),
    {
      name: 'earth-app-session',
      storage: createJSONStorage(() => sessionStorage),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...persistedState,
        layers: {
          ...defaultLayers,
          ...currentState.layers,
          ...persistedState?.layers,
        },
      }),
      partialize: (state) => ({
        layers: state.layers,
        satelliteLimit: state.satelliteLimit,
      }),
    },
  ),
)

export default useStore
