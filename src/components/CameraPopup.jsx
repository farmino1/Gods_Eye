import { useState } from 'react'

function formatLocation(camera) {
  return [camera?.city, camera?.state, camera?.country].filter(Boolean).join(', ')
}

function formatDateTime(value) {
  if (!value) {
    return 'Unknown'
  }

  const parsedDate = new Date(value)

  return Number.isNaN(parsedDate.getTime())
    ? value
    : parsedDate.toLocaleString()
}

function formatUpdateRate(updateRateMs) {
  const normalizedUpdateRateMs = Number(updateRateMs)

  if (!Number.isFinite(normalizedUpdateRateMs) || normalizedUpdateRateMs <= 0) {
    return 'Unknown'
  }

  if (normalizedUpdateRateMs < 60_000) {
    return `${Math.round(normalizedUpdateRateMs / 1000)}s`
  }

  const minutes = normalizedUpdateRateMs / 60_000
  return `${minutes.toFixed(minutes >= 10 ? 0 : 1)} min`
}

function CameraPreview({ camera }) {
  const [previewError, setPreviewError] = useState('')

  if (!camera?.feedUrl) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-2xl border border-white/10 bg-slate-950/70 px-4 text-sm text-slate-400">
        No preview URL is available for this camera.
      </div>
    )
  }

  if (previewError) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 text-sm leading-6 text-amber-100">
        {previewError}
      </div>
    )
  }

  if (camera.feedType === 'image' || camera.feedType === 'mjpeg') {
    return (
      <img
        src={camera.feedUrl}
        alt={camera.name}
        className="aspect-video w-full rounded-2xl border border-white/10 bg-slate-950 object-cover"
        referrerPolicy="no-referrer"
        onError={() => {
          setPreviewError(
            'This camera feed could not be previewed inline. Open it in a new tab to inspect the source directly.',
          )
        }}
      />
    )
  }

  if (camera.feedType === 'mp4') {
    return (
      <video
        src={camera.feedUrl}
        controls
        autoPlay
        muted
        playsInline
        className="aspect-video w-full rounded-2xl border border-white/10 bg-slate-950"
        referrerPolicy="no-referrer"
        onError={() => {
          setPreviewError(
            'This MP4 feed could not be previewed inline. Open it in a new tab to inspect the source directly.',
          )
        }}
      />
    )
  }

  if (camera.feedType === 'iframe') {
    return (
      <iframe
        src={camera.feedUrl}
        title={camera.name}
        className="aspect-video w-full rounded-2xl border border-white/10 bg-slate-950"
        referrerPolicy="no-referrer"
      />
    )
  }

  if (camera.feedType === 'm3u8') {
    return (
      <div className="flex aspect-video items-center justify-center rounded-2xl border border-white/10 bg-slate-950/80 px-4 text-sm leading-6 text-slate-300">
        This feed uses HLS (`.m3u8`), which usually needs an HLS-capable player.
        Use the button below to open it directly.
      </div>
    )
  }

  return (
    <div className="flex aspect-video items-center justify-center rounded-2xl border border-white/10 bg-slate-950/80 px-4 text-sm leading-6 text-slate-300">
      Inline preview is not available for `{camera.feedType || 'unknown'}` feeds.
    </div>
  )
}

function CameraPopup({
  camera,
  onClose,
} = {}) {
  if (!camera || camera.type !== 'camera') {
    return null
  }

  return (
    <div className="pointer-events-auto absolute right-6 top-6 z-20 w-[min(26rem,calc(100vw-3rem))] overflow-hidden rounded-3xl border border-white/10 bg-slate-950/92 shadow-2xl shadow-black/50 backdrop-blur-xl">
      <div className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-cyan-300/80">
            Camera Feed
          </p>
          <h2 className="mt-2 text-lg font-semibold text-white">
            {camera.name}
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            {formatLocation(camera) || 'Unknown location'}
          </p>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.2em] text-slate-300 transition hover:border-cyan-300/40 hover:text-white"
        >
          Close
        </button>
      </div>

      <div className="space-y-4 px-5 py-5">
        <CameraPreview
          key={`${camera.id}-${camera.feedUrl}-${camera.feedType}`}
          camera={camera}
        />

        <div className="flex flex-wrap gap-3">
          <a
            href={camera.feedUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-cyan-300/30 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-200/50 hover:bg-cyan-300/15"
          >
            Open In New Tab
          </a>

          <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs uppercase tracking-[0.2em] text-slate-300">
            {camera.feedType || 'unknown'} feed
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm text-slate-200">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
              Source
            </p>
            <p className="mt-1 font-medium text-white">{camera.source}</p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
              Update Rate
            </p>
            <p className="mt-1 font-medium text-white">
              {formatUpdateRate(camera.updateRateMs)}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
              Category
            </p>
            <p className="mt-1 font-medium capitalize text-white">
              {camera.category || 'Unknown'}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
              Direction
            </p>
            <p className="mt-1 font-medium text-white">
              {camera.direction || 'Unknown'}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
              Camera Code
            </p>
            <p className="mt-1 font-medium text-white">
              {camera.cameraCode ?? 'Unavailable'}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
              Timezone
            </p>
            <p className="mt-1 font-medium text-white">
              {camera.timezone || 'Unknown'}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
              Last Checked
            </p>
            <p className="mt-1 font-medium text-white">
              {formatDateTime(camera.lastChecked)}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
              Source Seen
            </p>
            <p className="mt-1 font-medium text-white">
              {formatDateTime(camera.lastSeenBySource)}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
              Views
            </p>
            <p className="mt-1 font-medium text-white">
              {(camera.viewCount ?? 0).toLocaleString()}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
              Shares
            </p>
            <p className="mt-1 font-medium text-white">
              {(camera.shareCount ?? 0).toLocaleString()}
            </p>
          </div>
        </div>

        {(camera.description || camera.feedLastModified || camera.trafficSlug) && (
          <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-slate-300">
            {camera.description && (
              <p className="leading-6 text-slate-200">{camera.description}</p>
            )}
            {camera.feedLastModified && (
              <p>
                Last modified: <span className="text-white">{camera.feedLastModified}</span>
              </p>
            )}
            {camera.trafficSlug && (
              <p>
                Feed slug: <span className="text-white">{camera.trafficSlug}</span>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default CameraPopup
