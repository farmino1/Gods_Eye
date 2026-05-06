import useStore from '../store/useStore'

const layerOptions = [
  { key: 'satellites', label: 'Satellites' },
  { key: 'aircraft', label: 'Aircraft' },
  { key: 'cameras', label: 'Cameras' },
  { key: 'buildings', label: 'Buildings (3D)' },
  { key: 'ships', label: 'Ships' },
  { key: 'gpsJamming', label: 'GPS Jamming' },
]

function LayerControls() {
  const layers = useStore((state) => state.layers)
  const toggleLayer = useStore((state) => state.toggleLayer)
  const satelliteLimit = useStore((state) => state.satelliteLimit)
  const satelliteTotal = useStore((state) => state.satelliteTotal)
  const setSatelliteLimit = useStore((state) => state.setSatelliteLimit)

  const clampedSatelliteLimit = Math.min(satelliteLimit, satelliteTotal)

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="mb-4">
        <h2 className="text-lg font-medium text-white">Layers</h2>
      </div>

      <div className="space-y-3">
        {layerOptions.map((layer) => (
          <label
            key={layer.key}
            className="flex cursor-pointer items-center justify-between rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3 transition hover:border-cyan-300/40 hover:bg-slate-900"
          >
            <span className="text-sm text-slate-200">{layer.label}</span>
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-white/20 bg-slate-900 text-cyan-400 focus:ring-cyan-400"
              checked={layers[layer.key]}
              onChange={() => toggleLayer(layer.key)}
            />
          </label>
        ))}
      </div>

      

      {layers.satellites && (
        <div className="mt-4 rounded-xl border border-cyan-400/10 bg-cyan-400/5 p-4">
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs uppercase tracking-[0.2em] text-cyan-200/80">
              Satellite cap
            </p>
            <p className="text-sm font-medium text-cyan-100">
              {clampedSatelliteLimit.toLocaleString()} / {satelliteTotal.toLocaleString()}
            </p>
          </div>

          <input
            type="range"
            min="1"
            max={Math.max(1, satelliteTotal)}
            step="1"
            value={clampedSatelliteLimit}
            onChange={(event) => setSatelliteLimit(event.target.value)}
            className="mt-4 h-2 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-cyan-400"
            aria-label="Satellite cap"
          />

          <div className="mt-3 flex items-center justify-between text-xs text-cyan-100/60">
            <span>1</span>
            <span>{satelliteTotal.toLocaleString()}</span>
          </div>
        </div>
      )}
    </section>
  )
}

export default LayerControls
