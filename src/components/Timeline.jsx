import { useEffect, useState } from 'react'
import useTimeStore from '../store/timeStore'
import {
  TIMELINE_WINDOW_HOURS,
  clampTimelineTime,
  getCombinedSnapshotRange,
  getPlaybackPercent,
  getTimelineBounds,
} from '../utils/timeline'

function formatTime(timestampMs) {
  if (!Number.isFinite(Number(timestampMs))) {
    return 'Unavailable'
  }

  const date = new Date(Number(timestampMs))
  return date.toLocaleString([], {
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export default function Timeline() {
  const [nowMs, setNowMs] = useState(() => Date.now())
  const currentTime = useTimeStore((state) => state.currentTime)
  const isPlaying = useTimeStore((state) => state.isPlaying)
  const speed = useTimeStore((state) => state.speed)
  const liveMode = useTimeStore((state) => state.liveMode)
  const snapshotHistory = useTimeStore((state) => state.snapshotHistory)
  const setCurrentTime = useTimeStore((state) => state.setCurrentTime)
  const play = useTimeStore((state) => state.play)
  const pause = useTimeStore((state) => state.pause)
  const tick = useTimeStore((state) => state.tick)
  const setSpeed = useTimeStore((state) => state.setSpeed)
  const jumpToLive = useTimeStore((state) => state.jumpToLive)

  const bounds = getTimelineBounds(nowMs)
  const clampedCurrentTime = clampTimelineTime(
    currentTime,
    bounds.maxTime,
    TIMELINE_WINDOW_HOURS,
  )
  const playbackPercent = Math.round(
    getPlaybackPercent(clampedCurrentTime, bounds),
  )
  const snapshotRange = getCombinedSnapshotRange(snapshotHistory)

  useEffect(() => {
    if (!isPlaying) {
      return
    }

    const interval = window.setInterval(tick, 1000)
    return () => window.clearInterval(interval)
  }, [isPlaying, tick])

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowMs(Date.now())
    }, 1000)

    return () => window.clearInterval(interval)
  }, [])

  return (
    <div className="flex h-full w-full flex-col justify-center gap-2 px-4">
      <div className="flex w-full items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={isPlaying ? pause : play}
            className="rounded border border-cyan-400/30 px-3 py-1 text-sm text-cyan-100 hover:bg-cyan-400/10"
          >
            {isPlaying ? 'Pause' : liveMode ? 'Resume' : 'Play from here'}
          </button>

          <button
            onClick={jumpToLive}
            className="rounded border border-white/10 px-3 py-1 text-sm text-slate-200 hover:bg-white/5"
          >
            Go Live
          </button>

          {liveMode && (
            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 text-[11px] uppercase tracking-[0.2em] text-emerald-200">
              Live
            </span>
          )}
        </div>

        <span className="text-xs text-slate-300">{formatTime(clampedCurrentTime)}</span>

        <select
          value={speed}
          onChange={(event) => setSpeed(Number(event.target.value))}
          className="rounded border border-white/10 bg-slate-900 px-2 py-1 text-sm"
        >
          <option value={0.25}>0.25x</option>
          <option value={0.5}>0.5x</option>
          <option value={1}>1x</option>
          <option value={2}>2x</option>
          <option value={4}>4x</option>
          <option value={8}>8x</option>
          <option value={24}>24x</option>
        </select>
      </div>

      <div className="flex w-full flex-col">
        <input
          type="range"
          min={bounds.minTime}
          max={bounds.maxTime}
          step={1000}
          value={clampedCurrentTime}
          onChange={(event) => {
            setCurrentTime(Number(event.target.value))
          }}
          className="w-full accent-cyan-400 h-2 rounded-full"
        />

        <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400">
          <span>{formatTime(bounds.minTime)}</span>
          <span>{playbackPercent}% of {TIMELINE_WINDOW_HOURS}h window</span>
          <span>{formatTime(bounds.maxTime)}</span>
        </div>
      </div>

      <div className="flex items-center justify-between gap-4 text-[11px] text-slate-500">
        <span>
          Satellites and weather have full replay coverage. Aircraft and ships
          only rewind captured session snapshots.
        </span>
        <span className="text-right">
          {snapshotRange
            ? `Cached snapshots: ${formatTime(snapshotRange.minTime)} to ${formatTime(snapshotRange.maxTime)}`
            : 'Snapshot history starts filling in once live aircraft or ships have been observed.'}
        </span>
      </div>
    </div>
  )
}
