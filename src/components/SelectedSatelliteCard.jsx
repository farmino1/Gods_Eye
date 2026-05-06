import { useEffect, useState } from 'react'
import useStore from '../store/useStore'
import { fetchShipInfo } from '../services/shipInfo.js'

// Flag code mapping for common flag codes used in maritime
const FLAG_CODE_MAP = {
  'NL': 'nl', 'US': 'us', 'GB': 'gb', 'DE': 'de', 'FR': 'fr',
  'JP': 'jp', 'CN': 'cn', 'KR': 'kr', 'IT': 'it', 'ES': 'es',
  'PT': 'pt', 'GR': 'gr', 'NO': 'no', 'SE': 'se', 'DK': 'dk',
  'FI': 'fi', 'BE': 'be', 'LU': 'lu', 'AT': 'at', 'CH': 'ch',
  'PL': 'pl', 'CZ': 'cz', 'HU': 'hu', 'RO': 'ro', 'BG': 'bg',
  'HR': 'hr', 'SI': 'si', 'SK': 'sk', 'LT': 'lt', 'LV': 'lv',
  'EE': 'ee', 'IE': 'ie', 'MT': 'mt', 'CY': 'cy', 'IS': 'is',
  'RU': 'ru', 'UA': 'ua', 'TR': 'tr', 'EG': 'eg', 'ZA': 'za',
  'NG': 'ng', 'KE': 'ke', 'GH': 'gh', 'BR': 'br', 'AR': 'ar',
  'CL': 'cl', 'PE': 'pe', 'CO': 'co', 'VE': 've', 'MX': 'mx',
  'PA': 'pa', 'CR': 'cr', 'HN': 'hn', 'GT': 'gt', 'SV': 'sv',
  'NI': 'ni', 'BZ': 'bz', 'CU': 'cu', 'JM': 'jm', 'HT': 'ht',
  'DO': 'do', 'PR': 'pr', 'TT': 'tt', 'BB': 'bb', 'GD': 'gd',
  'LC': 'lc', 'VC': 'vc', 'DM': 'dm', 'AG': 'ag', 'KN': 'kn',
  'BS': 'bs', 'KY': 'ky', 'BM': 'bm', 'TC': 'tc', 'VG': 'vg',
  'AI': 'ai', 'MS': 'ms', 'GP': 'gp', 'MQ': 'mq', 'GF': 'gf',
  'SR': 'sr', 'GY': 'gy', 'FK': 'fk', 'IN': 'in', 'ID': 'id',
  'MY': 'my', 'SG': 'sg', 'TH': 'th', 'VN': 'vn', 'PH': 'ph',
  'AU': 'au', 'NZ': 'nz', 'FJ': 'fj', 'PG': 'pg', 'SB': 'sb',
  'VU': 'vu', 'NC': 'nc', 'PF': 'pf', 'WS': 'ws', 'TO': 'to',
  'KI': 'ki', 'NR': 'nr', 'PW': 'pw', 'FM': 'fm', 'MH': 'mh',
  'AE': 'ae', 'SA': 'sa', 'QA': 'qa', 'BH': 'bh', 'KW': 'kw',
  'OM': 'om', 'YE': 'ye', 'IQ': 'iq', 'IR': 'ir', 'IL': 'il',
  'JO': 'jo', 'LB': 'lb', 'SY': 'sy', 'PK': 'pk', 'BD': 'bd',
  'LK': 'lk', 'MM': 'mm', 'KH': 'kh', 'LA': 'la', 'BN': 'bn',
  'TL': 'tl', 'CA': 'ca', 'GL': 'gl', 'FO': 'fo', 'AX': 'ax',
  'GG': 'gg', 'JE': 'je', 'IM': 'im', 'GI': 'gi', 'LI': 'li',
  'MC': 'mc', 'SM': 'sm', 'VA': 'va', 'AD': 'ad', 'KZ': 'kz',
  'UZ': 'uz', 'TM': 'tm', 'TJ': 'tj', 'KG': 'kg', 'GE': 'ge',
  'AM': 'am', 'AZ': 'az', 'BY': 'by', 'MD': 'md', 'RS': 'rs',
  'ME': 'me', 'BA': 'ba', 'MK': 'mk', 'AL': 'al', 'XK': 'xk',
  'TN': 'tn', 'DZ': 'dz', 'MA': 'ma', 'LY': 'ly', 'SD': 'sd',
  'SO': 'so', 'DJ': 'dj', 'ER': 'er', 'ET': 'et', 'UG': 'ug',
  'TZ': 'tz', 'MZ': 'mz', 'MG': 'mg', 'MU': 'mu', 'SC': 'sc',
  'KM': 'km', 'YT': 'yt', 'RE': 're', 'ZW': 'zw', 'ZM': 'zm',
  'MW': 'mw', 'BW': 'bw', 'NA': 'na', 'SZ': 'sz', 'LS': 'ls',
  'AO': 'ao', 'CD': 'cd', 'CG': 'cg', 'GA': 'ga', 'GQ': 'gq',
  'CM': 'cm', 'CF': 'cf', 'TD': 'td', 'NE': 'ne', 'ML': 'ml',
  'BF': 'bf', 'CI': 'ci', 'LR': 'lr', 'SL': 'sl', 'GN': 'gn',
  'GW': 'gw', 'SN': 'sn', 'GM': 'gm', 'CV': 'cv', 'MR': 'mr',
  'EH': 'eh', 'SH': 'sh', 'ST': 'st',
}

function getFlagImageCode(flagCode) {
  if (!flagCode) return 'unknown'
  const normalized = flagCode.toUpperCase().trim()
  return FLAG_CODE_MAP[normalized] || normalized.toLowerCase()
}

function getShipColorLegend() {
  return 'Blue cargo, green fishing, red tanker or military, purple passenger, amber tug, yellow pilot, slate other.'
}

function ShipDetailsCard({ selectedItem }) {
  const [shipInfo, setShipInfo] = useState(null)
  const [loading, setLoading] = useState(false)
  const currentMmsi = selectedItem?.mmsi

  useEffect(() => {
    if (!currentMmsi) {
      return
    }

    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading state is intentionally set before async fetch
    setLoading(true)

    fetchShipInfo(currentMmsi)
      .then((data) => {
        if (!cancelled) {
          setShipInfo(data)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [currentMmsi])

  const ship = shipInfo?.summary?.ship
  const latest = shipInfo?.summary?.latest
  const portCalls = shipInfo?.portCalls || []
  const speedSeries = shipInfo?.summary?.speed_series || []
  const nearbyLocations = shipInfo?.summary?.nearby_locations || []
  const speedKnots = latest?.speed_kn ?? selectedItem.speedKnots

  return (
    <div className="space-y-3 text-sm text-slate-200">
      {ship?.image_url && (
        <div className="overflow-hidden rounded-xl border border-white/10">
          <img
            src={ship.image_url}
            alt={ship.name || 'Vessel'}
            className="w-full h-32 object-cover"
            onError={(e) => {
              e.target.style.display = 'none'
            }}
          />
        </div>
      )}

      <div>
        <div className="flex items-center gap-2">
          <p className="text-xs uppercase tracking-[0.2em] text-sky-300/80">
            Vessel
          </p>
          {selectedItem.isMilitary && (
            <span className="rounded-full border border-red-400/30 bg-red-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.2em] text-red-200">
              Military
            </span>
          )}
        </div>
        <p className="mt-1 font-medium text-white">
          {ship?.name || selectedItem.name || 'Unnamed Vessel'}
        </p>
        {ship?.flag && (
          <div className="mt-2 flex items-center gap-2 rounded-lg border border-white/10 bg-slate-950/60 p-2">
            <img
              src={`https://flagcdn.com/w40/${getFlagImageCode(ship.flag)}.png`}
              alt={`${ship.country} flag`}
              className="h-4 w-6 rounded-sm object-cover"
              onError={(e) => {
                e.target.style.display = 'none'
              }}
            />
            <div>
              <p className="text-xs font-medium text-white">
                {ship.country}
              </p>
              <p className="text-[10px] text-slate-400">
                Flag: {ship.flag} | Callsign: {ship.callsign}
              </p>
            </div>
          </div>
        )}
        <p className="mt-2 text-xs leading-5 text-slate-400">
          {getShipColorLegend()}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
            MMSI
          </p>
          <p className="mt-1 font-medium text-white">{selectedItem.mmsi}</p>
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
            Type
          </p>
          <p className="mt-1 font-medium capitalize text-white">
            {ship?.type || selectedItem.shipType}
          </p>
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
            IMO
          </p>
          <p className="mt-1 font-medium text-white">
            {ship?.imo || selectedItem.imo || 'Unavailable'}
          </p>
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
            Speed
          </p>
          <p className="mt-1 font-medium text-white">
            {speedKnots?.toFixed?.(1) ?? selectedItem.speedKnots.toFixed(1)} kn
          </p>
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
            Heading
          </p>
          <p className="mt-1 font-medium text-white">
            {selectedItem.headingDegrees.toFixed(0)}&deg;
          </p>
        </div>

        <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
            Callsign
          </p>
          <p className="mt-1 font-medium text-white">
            {ship?.callsign || selectedItem.callsign}
          </p>
        </div>

        {ship?.length && (
          <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
              Length
            </p>
            <p className="mt-1 font-medium text-white">{ship.length} m</p>
          </div>
        )}

        {ship?.width && (
          <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
              Width
            </p>
            <p className="mt-1 font-medium text-white">{ship.width} m</p>
          </div>
        )}

        <div className="col-span-2 rounded-xl border border-white/10 bg-slate-950/60 p-3">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
            Destination
          </p>
          <p className="mt-1 font-medium text-white">
            {selectedItem.destination}
          </p>
        </div>

        {latest && (
          <div className="col-span-2 rounded-xl border border-white/10 bg-slate-950/60 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
              Last Position
            </p>
            <p className="mt-1 text-xs text-slate-300">
              {latest.lat?.toFixed(4)}, {latest.lng?.toFixed(4)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Updated: {latest.updated}
            </p>
            {latest.avg_speed_14d !== undefined && (
              <p className="mt-1 text-xs text-slate-400">
                14-day avg speed: {latest.avg_speed_14d.toFixed(2)} kn
              </p>
            )}
          </div>
        )}

        {speedSeries.length > 0 && (
          <div className="col-span-2 rounded-xl border border-white/10 bg-slate-950/60 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
              Speed History (60 days)
            </p>
            <div className="mt-2 flex items-end gap-px h-16">
              {speedSeries.slice(-60).map((point, index) => {
                const maxSpeed = Math.max(...speedSeries.map(s => s.value), 1)
                const heightPercent = Math.max(2, (point.value / maxSpeed) * 100)
                const isRecent = index > speedSeries.length - 15
                return (
                  <div
                    key={index}
                    className={`flex-1 rounded-t-sm transition-all ${
                      isRecent ? 'bg-sky-400' : 'bg-sky-400/40'
                    }`}
                    style={{ height: `${heightPercent}%` }}
                    title={`${point.point_ts}: ${point.value.toFixed(1)} kn`}
                  />
                )
              })}
            </div>
            <div className="mt-1 flex justify-between text-[9px] text-slate-500">
              <span>60d ago</span>
              <span>Today</span>
            </div>
          </div>
        )}

        {nearbyLocations.length > 0 && (
          <div className="col-span-2 rounded-xl border border-white/10 bg-slate-950/60 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
              Nearby Locations
            </p>
            <div className="mt-2 space-y-1">
              {nearbyLocations.slice(0, 3).map((loc, index) => (
                <p key={index} className="text-xs text-slate-300">
                  {loc.text}
                </p>
              ))}
            </div>
          </div>
        )}

        {portCalls.length > 0 && (
          <div className="col-span-2 rounded-xl border border-white/10 bg-slate-950/60 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
              Recent Port Calls
            </p>
            <div className="mt-2 space-y-2 max-h-40 overflow-y-auto">
              {portCalls.slice(0, 5).map((portCall, index) => (
                <div key={index} className="text-xs text-slate-300">
                  <p className="font-medium text-white">
                    {portCall.port_name}, {portCall.country_name}
                  </p>
                  <p>
                    {portCall.arrival?.slice(0, 10)} - {portCall.departure?.slice(0, 10)}
                    {portCall.duration_h > 0 && (
                      <span className="text-slate-500">
                        {' '}({portCall.duration_h.toFixed(1)}h)
                      </span>
                    )}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="col-span-2 rounded-xl border border-white/10 bg-slate-950/60 p-3">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
            Last Update
          </p>
          <p className="mt-1 font-medium text-white">
            {new Date(selectedItem.lastUpdateTimeMs).toLocaleString()}
          </p>
        </div>

        <div className="col-span-2 rounded-xl border border-white/10 bg-slate-950/60 p-3">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
            More Info
          </p>
          {selectedItem.moreInfoUrl ? (
            <a
              href={selectedItem.moreInfoUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex font-medium text-sky-300 transition hover:text-sky-200"
            >
              Open ShipInfo.net
            </a>
          ) : (
            <p className="mt-1 font-medium text-white">IMO unavailable</p>
          )}
        </div>
      </div>

      {loading && (
        <p className="text-xs text-slate-500">Loading ship details...</p>
      )}
    </div>
  )
}

function SelectedSatelliteCard() {
  const satellitesEnabled = useStore((state) => state.layers.satellites)
  const aircraftEnabled = useStore((state) => state.layers.aircraft)
  const camerasEnabled = useStore((state) => state.layers.cameras)
  const shipsEnabled = useStore((state) => state.layers.ships)
  const selectedItem = useStore((state) => state.selectedItem)
  const hasInteractiveLayers =
    satellitesEnabled ||
    aircraftEnabled ||
    camerasEnabled ||
    shipsEnabled
  const hasSatelliteSelection =
    selectedItem && selectedItem.type === 'satellite'
  const hasAircraftSelection =
    selectedItem && selectedItem.type === 'aircraft'
  const hasCameraSelection =
    selectedItem && selectedItem.type === 'camera'
  const hasShipSelection =
    selectedItem && selectedItem.type === 'ship'

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="mb-4">
        <h2 className="text-lg font-medium text-white">Selected Object</h2>
        <p className="mt-1 text-sm text-slate-400">
          Live details update while the active tracking layers are visible.
        </p>
      </div>

      {!hasInteractiveLayers && (
        <p className="text-sm leading-6 text-slate-400">
          Turn on the satellite, aircraft, camera, or ship layers
          to load live tracked objects.
        </p>
      )}

      {hasInteractiveLayers &&
        !hasSatelliteSelection &&
        !hasAircraftSelection &&
        !hasCameraSelection &&
        !hasShipSelection && (
        <p className="text-sm leading-6 text-slate-400">
          Click any visible satellite, orbit trail, aircraft icon, camera dot,
          or ship icon to inspect its live details.
        </p>
      )}

      {hasSatelliteSelection && (
        <div className="space-y-3 text-sm text-slate-200">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/80">
                Name
              </p>
              {selectedItem.isMilitary && (
                <span className="rounded-full border border-red-400/30 bg-red-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.2em] text-red-200">
                  Military
                </span>
              )}
            </div>
            <p className="mt-1 font-medium text-white">{selectedItem.name}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                NORAD ID
              </p>
              <p className="mt-1 font-medium text-white">{selectedItem.noradId}</p>
            </div>

            <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Altitude
              </p>
              <p className="mt-1 font-medium text-white">
                {selectedItem.altitudeKm.toFixed(1)} km
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Velocity
              </p>
              <p className="mt-1 font-medium text-white">
                {selectedItem.velocityKmS.toFixed(2)} km/s
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                More Info
              </p>
              <a
                href={selectedItem.satcatUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex font-medium text-cyan-300 transition hover:text-cyan-200"
              >
                Open Satcat
              </a>
            </div>
          </div>
        </div>
      )}

      {hasAircraftSelection && (
        <div className="space-y-3 text-sm text-slate-200">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-xs uppercase tracking-[0.2em] text-amber-300/80">
                Callsign
              </p>
              {selectedItem.isMilitary && (
                <span className="rounded-full border border-red-400/30 bg-red-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.2em] text-red-200">
                  Military
                </span>
              )}
            </div>
            <p className="mt-1 font-medium text-white">{selectedItem.callsign}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                ICAO24
              </p>
              <p className="mt-1 font-medium text-white">{selectedItem.icao24}</p>
            </div>

            <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Altitude
              </p>
              <p className="mt-1 font-medium text-white">
                {selectedItem.altitudeMeters.toFixed(0)} m
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Speed
              </p>
              <p className="mt-1 font-medium text-white">
                {selectedItem.velocityMS.toFixed(0)} m/s
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Heading
              </p>
              <p className="mt-1 font-medium text-white">
                {selectedItem.headingDegrees.toFixed(0)}&deg;
              </p>
            </div>

            <div className="col-span-2 rounded-xl border border-white/10 bg-slate-950/60 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Origin Country
              </p>
              <p className="mt-1 font-medium text-white">
                {selectedItem.originCountry}
              </p>
            </div>

            <div className="col-span-2 rounded-xl border border-white/10 bg-slate-950/60 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Status
              </p>
              <p className="mt-1 font-medium text-white">
                {selectedItem.onGround ? 'On ground' : 'In flight'}
              </p>
            </div>

            <div className="col-span-2 rounded-xl border border-white/10 bg-slate-950/60 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                More Info
              </p>
              <a
                href={selectedItem.moreInfoUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex font-medium text-amber-300 transition hover:text-amber-200"
              >
                Open ADS-B Exchange
              </a>
            </div>
          </div>
        </div>
      )}

      {hasCameraSelection && (
        <div className="space-y-3 text-sm text-slate-200">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-xs uppercase tracking-[0.2em] text-cyan-300/80">
                Camera
              </p>
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.2em] text-slate-200">
                Local Catalog
              </span>
            </div>
            <p className="mt-1 font-medium text-white">{selectedItem.name}</p>
            <p className="mt-2 text-xs leading-5 text-slate-400">
              The live preview opens over the globe so you can inspect the feed
              without leaving the map.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Location
              </p>
              <p className="mt-1 font-medium text-white">
                {selectedItem.locationLabel}
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Feed Type
              </p>
              <p className="mt-1 font-medium uppercase text-white">
                {selectedItem.feedType}
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Source
              </p>
              <p className="mt-1 font-medium text-white">
                {selectedItem.source}
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Update Rate
              </p>
              <p className="mt-1 font-medium text-white">
                {selectedItem.updateRateMs > 0
                  ? `${Math.round(selectedItem.updateRateMs / 1000)}s`
                  : 'Unknown'}
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Timezone
              </p>
              <p className="mt-1 font-medium text-white">
                {selectedItem.timezone || 'Unknown'}
              </p>
            </div>

            <div className="rounded-xl border border-white/10 bg-slate-950/60 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Camera Code
              </p>
              <p className="mt-1 font-medium text-white">
                {selectedItem.cameraCode ?? 'Unavailable'}
              </p>
            </div>

            <div className="col-span-2 rounded-xl border border-white/10 bg-slate-950/60 p-3">
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                Feed
              </p>
              <a
                href={selectedItem.feedUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex font-medium text-cyan-300 transition hover:text-cyan-200"
              >
                Open camera feed
              </a>
            </div>
          </div>
        </div>
      )}

      {hasShipSelection && (
        <ShipDetailsCard selectedItem={selectedItem} />
      )}
    </section>
  )
}

export default SelectedSatelliteCard
