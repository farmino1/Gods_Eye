import axios from 'axios'

export const PREDICTIONS_ENDPOINT = '/api/predictions/markets'
export const PREDICTION_REFRESH_MS = 60_000

export const PREDICTION_CATEGORIES = [
  {
    key: 'politics',
    label: 'Politics',
  },
  {
    key: 'geopolitics',
    label: 'Geopolitics',
  },
]

function toTrimmedString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() || fallback : fallback
}

function toFiniteNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') {
    return fallback
  }

  const parsedValue = Number(value)
  return Number.isFinite(parsedValue) ? parsedValue : fallback
}

function normalizePredictionMarket(market = {}) {
  return {
    id: toTrimmedString(market.id),
    question: toTrimmedString(market.question, 'Untitled market'),
    slug: toTrimmedString(market.slug),
    startDate: toTrimmedString(market.startDate),
    endDate: toTrimmedString(market.endDate),
    volume24hr: toFiniteNumber(market.volume24hr),
    volume: toFiniteNumber(market.volume),
    liquidity: toFiniteNumber(market.liquidity),
    bestBid: toFiniteNumber(market.bestBid),
    bestAsk: toFiniteNumber(market.bestAsk),
    lastTradePrice: toFiniteNumber(market.lastTradePrice),
    yesLabel: toTrimmedString(market.yesLabel, 'Yes'),
    yesPrice: Math.max(0, Math.min(1, toFiniteNumber(market.yesPrice))),
    noLabel: toTrimmedString(market.noLabel, 'No'),
    noPrice: Math.max(0, Math.min(1, toFiniteNumber(market.noPrice))),
    outcomes: Array.isArray(market.outcomes)
      ? market.outcomes.map((outcome) => ({
        label: toTrimmedString(outcome?.label, 'Outcome'),
        price: Math.max(0, Math.min(1, toFiniteNumber(outcome?.price))),
      }))
      : [],
  }
}

function normalizeTimelineSegment(segment = {}) {
  return {
    id: toTrimmedString(segment.id),
    type: toTrimmedString(segment.type, 'dated-market'),
    marketId: toTrimmedString(segment.marketId),
    marketQuestion: toTrimmedString(segment.marketQuestion),
    startDate: toTrimmedString(segment.startDate),
    endDate: toTrimmedString(segment.endDate),
    probability: Math.max(0, Math.min(1, toFiniteNumber(segment.probability))),
    cumulativeProbability: Math.max(
      0,
      Math.min(1, toFiniteNumber(segment.cumulativeProbability)),
    ),
    volume24hr: toFiniteNumber(segment.volume24hr),
    volume: toFiniteNumber(segment.volume),
    liquidity: toFiniteNumber(segment.liquidity),
    yesPrice: Math.max(0, Math.min(1, toFiniteNumber(segment.yesPrice))),
    noPrice: Math.max(0, Math.min(1, toFiniteNumber(segment.noPrice))),
  }
}

function normalizePredictionEvent(event = {}) {
  return {
    id: toTrimmedString(event.id),
    categoryKey: toTrimmedString(event.categoryKey),
    categoryLabel: toTrimmedString(event.categoryLabel),
    eventTitle: toTrimmedString(event.eventTitle, 'Untitled event'),
    eventSlug: toTrimmedString(event.eventSlug),
    description: toTrimmedString(event.description),
    image: toTrimmedString(event.image),
    icon: toTrimmedString(event.icon),
    volume24hr: toFiniteNumber(event.volume24hr),
    volume: toFiniteNumber(event.volume),
    openInterest: toFiniteNumber(event.openInterest),
    liquidity: toFiniteNumber(event.liquidity),
    commentCount: Math.max(0, toFiniteNumber(event.commentCount)),
    startDate: toTrimmedString(event.startDate),
    endDate: toTrimmedString(event.endDate),
    eventUrl: toTrimmedString(event.eventUrl),
    activeMarketCount: Math.max(0, toFiniteNumber(event.activeMarketCount)),
    tags: Array.isArray(event.tags)
      ? event.tags.map((tag) => ({
        id: toTrimmedString(tag?.id),
        label: toTrimmedString(tag?.label, 'Unlabeled'),
        slug: toTrimmedString(tag?.slug),
      }))
      : [],
    markets: Array.isArray(event.markets)
      ? event.markets.map(normalizePredictionMarket).filter(Boolean)
      : [],
    timelineDistribution: event.timelineDistribution
      ? {
        kind: toTrimmedString(event.timelineDistribution.kind),
        datedMarketCount: Math.max(
          0,
          toFiniteNumber(event.timelineDistribution.datedMarketCount),
        ),
        finalCumulativeProbability: Math.max(
          0,
          Math.min(
            1,
            toFiniteNumber(event.timelineDistribution.finalCumulativeProbability),
          ),
        ),
        segments: Array.isArray(event.timelineDistribution.segments)
          ? event.timelineDistribution.segments
            .map(normalizeTimelineSegment)
            .filter(Boolean)
          : [],
      }
      : null,
    primaryMarket: {
      id: toTrimmedString(event.primaryMarket?.id),
      question: toTrimmedString(
        event.primaryMarket?.question,
        'Untitled market',
      ),
      slug: toTrimmedString(event.primaryMarket?.slug),
      volume24hr: toFiniteNumber(event.primaryMarket?.volume24hr),
      volume: toFiniteNumber(event.primaryMarket?.volume),
      liquidity: toFiniteNumber(event.primaryMarket?.liquidity),
      endDate: toTrimmedString(event.primaryMarket?.endDate),
      bestBid: toFiniteNumber(event.primaryMarket?.bestBid),
      bestAsk: toFiniteNumber(event.primaryMarket?.bestAsk),
      lastTradePrice: toFiniteNumber(event.primaryMarket?.lastTradePrice),
      yesLabel: toTrimmedString(event.primaryMarket?.yesLabel, 'Yes'),
      yesPrice: Math.max(0, Math.min(1, toFiniteNumber(event.primaryMarket?.yesPrice))),
      noLabel: toTrimmedString(event.primaryMarket?.noLabel, 'No'),
      noPrice: Math.max(0, Math.min(1, toFiniteNumber(event.primaryMarket?.noPrice))),
    },
  }
}

export async function fetchPredictionMarkets() {
  const response = await axios.get(PREDICTIONS_ENDPOINT, {
    timeout: 15_000,
  })

  return {
    source: response.data?.source ?? 'polymarket',
    generatedAt: toFiniteNumber(response.data?.generatedAt, Date.now()),
    categories: Array.isArray(response.data?.categories)
      ? response.data.categories.map((category) => ({
        key: toTrimmedString(category?.key),
        label: toTrimmedString(category?.label, 'Category'),
        tagSlug: toTrimmedString(category?.tagSlug),
        events: Array.isArray(category?.events)
          ? category.events.map(normalizePredictionEvent).filter(Boolean)
          : [],
      }))
      : PREDICTION_CATEGORIES.map((category) => ({
        ...category,
        events: [],
      })),
  }
}
