import { useEffect, useState } from 'react'
import {
  PREDICTION_CATEGORIES,
  PREDICTION_REFRESH_MS,
  fetchPredictionMarkets,
} from '../services/predictions.js'

const TIMELINE_SEGMENT_COLORS = [
  '#22d3ee',
  '#38bdf8',
  '#60a5fa',
  '#818cf8',
  '#a78bfa',
  '#f472b6',
  '#fb7185',
  '#f59e0b',
]
const RESIDUAL_SEGMENT_COLOR = '#475569'

function formatCompactNumber(value) {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: value >= 100 ? 0 : 1,
  }).format(Math.max(0, Number(value) || 0))
}

function formatPercent(value) {
  return `${Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100)}%`
}

function parseDate(value) {
  const parsedDate = new Date(value)
  return Number.isNaN(parsedDate.getTime()) ? null : parsedDate
}

function formatDateLabel(value) {
  const parsedDate = parseDate(value)

  if (!parsedDate) {
    return 'Open-ended'
  }

  return parsedDate.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function formatLastUpdated(value) {
  const parsedDate = parseDate(value)

  if (!parsedDate) {
    return 'Unavailable'
  }

  return parsedDate.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatShortDate(value) {
  const parsedDate = parseDate(value)

  if (!parsedDate) {
    return 'Unknown date'
  }

  return parsedDate.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
  })
}

function addDays(value, days) {
  const parsedDate = parseDate(value)

  if (!parsedDate) {
    return ''
  }

  const nextDate = new Date(parsedDate)
  nextDate.setUTCDate(nextDate.getUTCDate() + days)
  return nextDate.toISOString()
}

function isSameCalendarDay(leftValue, rightValue) {
  const leftDate = parseDate(leftValue)
  const rightDate = parseDate(rightValue)

  if (!leftDate || !rightDate) {
    return false
  }

  return leftDate.toISOString().slice(0, 10) === rightDate.toISOString().slice(0, 10)
}

function extractQuestionDateLabel(question) {
  if (typeof question !== 'string' || !question.trim()) {
    return ''
  }

  const byMatch = question.match(/\bby\s+(.+?)\?*$/i)

  if (byMatch?.[1]) {
    return byMatch[1].trim()
  }

  return ''
}

function getMarketDisplayLabel(market) {
  const questionDateLabel = extractQuestionDateLabel(market?.question)

  if (questionDateLabel) {
    return questionDateLabel
  }

  if (market?.endDate) {
    return formatShortDate(market.endDate)
  }

  return market?.question || 'Market'
}

function getMultiMarketSlices(event) {
  const markets = Array.isArray(event?.markets)
    ? event.markets.filter((market) => market && market.id)
    : []

  if (markets.length < 2) {
    return []
  }

  const totalProbability = markets.reduce(
    (sum, market) => sum + Math.max(0, Math.min(1, Number(market.yesPrice) || 0)),
    0,
  )

  if (totalProbability < 0.92 || totalProbability > 1.08) {
    return []
  }

  return markets.map((market, index) => ({
    id: market.id,
    label: getMarketDisplayLabel(market),
    probability: Math.max(0, Math.min(1, Number(market.yesPrice) || 0)),
    normalizedProbability:
      totalProbability > 0
        ? Math.max(0, Math.min(1, market.yesPrice / totalProbability))
        : 0,
    volume24hr: market.volume24hr,
    question: market.question,
    color:
      TIMELINE_SEGMENT_COLORS[index % TIMELINE_SEGMENT_COLORS.length],
  }))
}

function hasMultiMarketLadder(event) {
  return getMultiMarketSlices(event).length > 1
}

function hasMultiDateTimeline(event) {
  return (event?.timelineDistribution?.datedMarketCount ?? 0) > 1 &&
    Array.isArray(event?.timelineDistribution?.segments) &&
    event.timelineDistribution.segments.length > 0
}

function getEventSubtitle(event) {
  return event?.primaryMarket?.question || event?.description || ''
}

function getTimelineSegmentColor(segmentIndex, segment) {
  if (segment?.type === 'residual') {
    return RESIDUAL_SEGMENT_COLOR
  }

  return TIMELINE_SEGMENT_COLORS[
    segmentIndex % TIMELINE_SEGMENT_COLORS.length
  ]
}

function formatTimelineSegmentLabel(segment) {
  if (!segment) {
    return 'Unscheduled'
  }

  if (segment.type === 'residual') {
    return segment.startDate
      ? `After ${formatShortDate(segment.startDate)}`
      : 'Later or unresolved'
  }

  if (!segment.endDate) {
    return 'Undated market'
  }

  if (!segment.startDate) {
    return `By ${formatShortDate(segment.endDate)}`
  }

  const exclusiveStartDate = addDays(segment.startDate, 1)

  if (!exclusiveStartDate) {
    return `By ${formatShortDate(segment.endDate)}`
  }

  if (isSameCalendarDay(exclusiveStartDate, segment.endDate)) {
    return formatShortDate(segment.endDate)
  }

  return `${formatShortDate(exclusiveStartDate)}-${formatShortDate(segment.endDate)}`
}

function getTimelineSegmentDescription(segment) {
  if (!segment) {
    return ''
  }

  if (segment.type === 'residual') {
    return 'Probability mass after the final listed date or outside the shown date ladder.'
  }

  const detailParts = [
    `Cumulative by ${formatShortDate(segment.endDate)}: ${formatPercent(segment.cumulativeProbability)}`,
  ]

  if ((segment.volume24hr ?? 0) > 0) {
    detailParts.push(`24h vol $${formatCompactNumber(segment.volume24hr)}`)
  }

  return detailParts.join(' • ')
}

function MultiMarketDistribution({ event }) {
  const slices = getMultiMarketSlices(event)

  if (!slices.length) {
    return null
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.22em] text-slate-400">
        <span>Live market ladder</span>
        <span>100% split</span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/90">
        <div className="flex h-4 w-full">
          {slices.map((slice) => (
            <div
              key={slice.id}
              className="h-full"
              style={{
                width: `${Math.max(0, Math.min(100, slice.normalizedProbability * 100))}%`,
                backgroundColor: slice.color,
              }}
              title={`${slice.label}: ${formatPercent(slice.probability)}`}
              aria-hidden="true"
            />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {slices.map((slice) => (
          <div
            key={slice.id}
            className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: slice.color,
                    }}
                  />
                  <p className="text-sm font-medium text-white">
                    {slice.label}
                  </p>
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-400">
                  {slice.question}
                </p>
              </div>

              <div className="shrink-0 text-right">
                <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                  Market odds
                </p>
                <p className="mt-1 text-lg font-semibold text-white">
                  {formatPercent(slice.probability)}
                </p>
                {(slice.volume24hr ?? 0) > 0 && (
                  <p className="mt-1 text-xs text-slate-400">
                    24h vol ${formatCompactNumber(slice.volume24hr)}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function TimelineDistribution({ event }) {
  const segments = event?.timelineDistribution?.segments ?? []

  if (!segments.length) {
    return null
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.22em] text-slate-400">
        <span>Timeline odds</span>
        <span>Exclusive slices</span>
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/90">
        <div className="flex h-4 w-full">
          {segments.map((segment, index) => (
            <div
              key={segment.id || `${event.id}-segment-${index}`}
              className="h-full"
              style={{
                width: `${Math.max(0, Math.min(100, segment.probability * 100))}%`,
                backgroundColor: getTimelineSegmentColor(index, segment),
              }}
              title={`${formatTimelineSegmentLabel(segment)}: ${formatPercent(segment.probability)}`}
              aria-hidden="true"
            />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {segments.map((segment, index) => {
          const segmentColor = getTimelineSegmentColor(index, segment)

          return (
            <div
              key={segment.id || `${event.id}-segment-row-${index}`}
              className="rounded-2xl border border-white/10 bg-slate-900/70 p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{
                        backgroundColor: segmentColor,
                      }}
                    />
                    <p className="text-sm font-medium text-white">
                      {formatTimelineSegmentLabel(segment)}
                    </p>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-400">
                    {getTimelineSegmentDescription(segment)}
                  </p>
                </div>

                <div className="shrink-0 text-right">
                  <p className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
                    {segment.type === 'residual' ? 'Remaining' : 'Slice'}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-white">
                    {formatPercent(segment.probability)}
                  </p>
                  {segment.type !== 'residual' && (
                    <p className="mt-1 text-xs text-slate-400">
                      By date {formatPercent(segment.cumulativeProbability)}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function BinaryProbabilityBar({ event }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs uppercase tracking-[0.22em] text-slate-400">
        <span>{event.primaryMarket.yesLabel}</span>
        <span>{event.primaryMarket.noLabel}</span>
      </div>

      <div className="mt-3 overflow-hidden rounded-full border border-white/10 bg-slate-900/80">
        <div
          className="flex h-3 rounded-full bg-[linear-gradient(90deg,_#22d3ee,_#fb7185)]"
          aria-hidden="true"
        >
          <div
            className="bg-cyan-400/85"
            style={{
              width: `${Math.max(
                4,
                Math.min(96, event.primaryMarket.yesPrice * 100),
              )}%`,
            }}
          />
          <div className="flex-1 bg-rose-400/80" />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm font-medium text-white">
        <span>{formatPercent(event.primaryMarket.yesPrice)}</span>
        <span>{formatPercent(event.primaryMarket.noPrice)}</span>
      </div>
    </div>
  )
}

function PredictionEventCard({ event }) {
  const showMultiMarketDistribution = hasMultiMarketLadder(event)
  const showTimelineDistribution =
    !showMultiMarketDistribution && hasMultiDateTimeline(event)
  const summaryVolume24hr = Math.max(
    0,
    Number(event.volume24hr) || Number(event.primaryMarket.volume24hr) || 0,
  )
  const summaryVolume = Math.max(
    0,
    Number(event.volume) || Number(event.primaryMarket.volume) || 0,
  )
  const summaryLiquidity = Math.max(
    0,
    Number(event.liquidity) || Number(event.primaryMarket.liquidity) || 0,
  )
  const summaryEndDate = event.endDate || event.primaryMarket.endDate

  return (
    <article className="group overflow-hidden rounded-[28px] border border-white/10 bg-slate-950/70 shadow-[0_30px_120px_rgba(2,6,23,0.55)] transition hover:-translate-y-1 hover:border-cyan-300/30">
      <div className="relative overflow-hidden border-b border-white/10 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.22),_transparent_45%),radial-gradient(circle_at_top_right,_rgba(248,113,113,0.18),_transparent_42%),linear-gradient(180deg,_rgba(15,23,42,0.96),_rgba(2,6,23,0.98))] p-6">
        <div className="absolute inset-0 bg-[linear-gradient(120deg,transparent,rgba(255,255,255,0.05),transparent)] opacity-0 transition group-hover:opacity-100" />
        <div className="relative flex items-start justify-between gap-4">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-2.5 py-1 text-[10px] uppercase tracking-[0.25em] text-cyan-100">
                {event.categoryLabel}
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] uppercase tracking-[0.25em] text-slate-300">
                {event.activeMarketCount} live markets
              </span>
            </div>

            <div>
              <h3 className="max-w-2xl text-xl font-semibold leading-tight text-white">
                {event.eventTitle}
              </h3>
              {getEventSubtitle(event) && (
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                  {getEventSubtitle(event)}
                </p>
              )}
            </div>
          </div>

          {(event.image || event.icon) && (
            <img
              src={event.image || event.icon}
              alt=""
              className="hidden h-16 w-16 shrink-0 rounded-2xl border border-white/10 object-cover sm:block"
            />
          )}
        </div>
      </div>

      <div className="space-y-5 p-6">
        {showMultiMarketDistribution
          ? <MultiMarketDistribution event={event} />
          : showTimelineDistribution
          ? <TimelineDistribution event={event} />
          : <BinaryProbabilityBar event={event} />}

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
              24h volume
            </p>
            <p className="mt-2 text-lg font-semibold text-white">
              ${formatCompactNumber(summaryVolume24hr)}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
              Total volume
            </p>
            <p className="mt-2 text-lg font-semibold text-white">
              ${formatCompactNumber(summaryVolume)}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
              Liquidity
            </p>
            <p className="mt-2 text-lg font-semibold text-white">
              ${formatCompactNumber(summaryLiquidity)}
            </p>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-4">
            <p className="text-[11px] uppercase tracking-[0.22em] text-slate-400">
              Closes
            </p>
            <p className="mt-2 text-lg font-semibold text-white">
              {formatDateLabel(summaryEndDate)}
            </p>
          </div>
        </div>

        {!!event.tags.length && (
          <div className="flex flex-wrap gap-2">
            {event.tags.slice(0, 5).map((tag) => (
              <span
                key={`${event.id}-${tag.slug || tag.label}`}
                className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300"
              >
                {tag.label}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center justify-end gap-4 border-t border-white/10 pt-4 text-sm text-slate-400">
          {event.eventUrl && (
            <a
              href={event.eventUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-cyan-300 transition hover:text-cyan-200"
            >
              Open market
            </a>
          )}
        </div>
      </div>
    </article>
  )
}

function PredictionsPage() {
  const [status, setStatus] = useState('loading')
  const [payload, setPayload] = useState({
    source: 'polymarket',
    generatedAt: 0,
    categories: PREDICTION_CATEGORIES.map((category) => ({
      ...category,
      events: [],
    })),
  })
  const [activeCategoryKey, setActiveCategoryKey] = useState(
    PREDICTION_CATEGORIES[0].key,
  )
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    let cancelled = false

    const refreshMarkets = async ({ silent = false } = {}) => {
      if (!silent) {
        setStatus('loading')
      }

      try {
        const nextPayload = await fetchPredictionMarkets()

        if (cancelled) {
          return
        }

        setPayload(nextPayload)
        setStatus('ready')
        setErrorMessage('')
      } catch (error) {
        if (cancelled) {
          return
        }

        setStatus('error')
        setErrorMessage(
          error?.response?.data?.error ||
            'Unable to load live prediction markets right now.',
        )
      }
    }

    refreshMarkets()

    const intervalId = window.setInterval(() => {
      refreshMarkets({
        silent: true,
      })
    }, PREDICTION_REFRESH_MS)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [])

  const resolvedActiveCategoryKey = payload.categories.some(
    (category) => category.key === activeCategoryKey,
  )
    ? activeCategoryKey
    : payload.categories[0]?.key
  const activeCategory =
    payload.categories.find(
      (category) => category.key === resolvedActiveCategoryKey,
    ) ?? payload.categories[0]

  return (
    <div className="relative h-full overflow-y-auto bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.12),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(248,113,113,0.12),_transparent_30%),linear-gradient(180deg,_#020617,_#0f172a_45%,_#020617)]">
      <div className="mx-auto flex min-h-full w-full max-w-7xl flex-col gap-8 px-6 py-8 lg:px-10">
        <section className="rounded-[32px] border border-white/10 bg-slate-950/70 p-8 shadow-[0_35px_120px_rgba(2,6,23,0.5)] backdrop-blur-xl">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs uppercase tracking-[0.35em] text-cyan-300/80">
                Prediction Markets
              </p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-white">
                Live politics and geopolitics pricing
              </h1>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 px-5 py-4 text-sm text-slate-300">
              <p className="text-xs uppercase tracking-[0.25em] text-slate-400">
                Last refresh
              </p>
              <p className="mt-2 font-medium text-white">
                {formatLastUpdated(payload.generatedAt)}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Auto-refresh every {Math.round(PREDICTION_REFRESH_MS / 1000)} seconds
              </p>
            </div>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            {payload.categories.map((category) => {
              const isActive = category.key === activeCategory?.key

              return (
                <button
                  key={category.key}
                  type="button"
                  onClick={() => setActiveCategoryKey(category.key)}
                  className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                    isActive
                      ? 'border-cyan-300/40 bg-cyan-400/15 text-cyan-100'
                      : 'border-white/10 bg-white/5 text-slate-300 hover:border-cyan-300/25 hover:text-white'
                  }`}
                >
                  {category.label}
                  <span className="ml-2 text-xs opacity-80">
                    {category.events.length}
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        {status === 'loading' && (
          <div className="rounded-[28px] border border-white/10 bg-slate-950/70 p-8 text-sm text-slate-300">
            Loading live prediction markets...
          </div>
        )}

        {status === 'error' && (
          <div className="rounded-[28px] border border-red-400/20 bg-red-500/10 p-8 text-sm text-red-100">
            {errorMessage}
          </div>
        )}

        {status !== 'loading' && activeCategory && !activeCategory.events.length && (
          <div className="rounded-[28px] border border-white/10 bg-slate-950/70 p-8 text-sm text-slate-300">
            {`No live markets are available in ${activeCategory.label.toLowerCase()} right now.`}
          </div>
        )}

        {activeCategory?.events?.length > 0 && (
          <section className="grid gap-6 pb-4 xl:grid-cols-2">
            {activeCategory.events.map((event) => (
              <PredictionEventCard key={event.id} event={event} />
            ))}
          </section>
        )}
      </div>
    </div>
  )
}

export default PredictionsPage
