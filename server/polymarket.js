import axios from 'axios'

const POLYMARKET_GAMMA_BASE_URL = 'https://gamma-api.polymarket.com'
const POLYMARKET_EVENT_ORDER_CANDIDATES = [
  'volume24hr',
  'volume_24hr',
  'volume',
]

export const PREDICTION_MARKET_CATEGORIES = [
  {
    key: 'politics',
    label: 'Politics',
    tagId: '2',
    tagSlug: 'politics',
  },
  {
    key: 'geopolitics',
    label: 'Geopolitics',
    tagId: '100265',
    tagSlug: 'geopolitics',
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

export function parseJsonArrayField(value) {
  if (Array.isArray(value)) {
    return value
  }

  if (typeof value !== 'string' || !value.trim()) {
    return []
  }

  try {
    const parsedValue = JSON.parse(value)
    return Array.isArray(parsedValue) ? parsedValue : []
  } catch {
    return []
  }
}

function buildMarketOutcomes(market = {}) {
  const labels = parseJsonArrayField(market.outcomes).map((label) =>
    toTrimmedString(label, 'Outcome'),
  )
  const prices = parseJsonArrayField(market.outcomePrices).map((price) =>
    Math.max(0, Math.min(1, toFiniteNumber(price))),
  )

  return labels.map((label, index) => ({
    label,
    price: Math.max(0, Math.min(1, toFiniteNumber(prices[index]))),
  }))
}

function pickPrimaryBinaryOutcome(outcomes = [], labelPattern, fallbackIndex) {
  const matchingOutcome = outcomes.find((outcome) =>
    labelPattern.test(outcome.label),
  )

  if (matchingOutcome) {
    return matchingOutcome
  }

  return outcomes[fallbackIndex] ?? null
}

function normalizePolymarketTags(tags) {
  if (!Array.isArray(tags)) {
    return []
  }

  return tags
    .map((tag) => ({
      id: toTrimmedString(tag?.id),
      label: toTrimmedString(tag?.label, 'Unlabeled'),
      slug: toTrimmedString(tag?.slug),
    }))
    .filter((tag) => tag.id || tag.slug || tag.label)
}

function parseDateMs(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return null
  }

  const parsedDateMs = Date.parse(value)
  return Number.isFinite(parsedDateMs) ? parsedDateMs : null
}

function sortMarketsByDisplayPriority(markets = []) {
  return [...markets].sort((leftMarket, rightMarket) => {
    const rightVolume24hr = toFiniteNumber(
      rightMarket?.volume24hr,
      rightMarket?.volumeNum,
    )
    const leftVolume24hr = toFiniteNumber(
      leftMarket?.volume24hr,
      leftMarket?.volumeNum,
    )

    if (rightVolume24hr !== leftVolume24hr) {
      return rightVolume24hr - leftVolume24hr
    }

    const rightVolume = toFiniteNumber(
      rightMarket?.volume,
      rightMarket?.volumeNum,
    )
    const leftVolume = toFiniteNumber(
      leftMarket?.volume,
      leftMarket?.volumeNum,
    )

    if (rightVolume !== leftVolume) {
      return rightVolume - leftVolume
    }

    return toTrimmedString(leftMarket?.id).localeCompare(
      toTrimmedString(rightMarket?.id),
    )
  })
}

function isInvalidOrderFieldError(error) {
  const statusCode = Number(error?.response?.status)
  const responseData = error?.response?.data
  const message = toTrimmedString(
    responseData?.error,
    toTrimmedString(responseData?.message),
  )

  return (
    statusCode >= 400 &&
    statusCode < 500 &&
    /order fields are not valid/i.test(message)
  )
}

function normalizePredictionMarket(market = {}) {
  const outcomes = buildMarketOutcomes(market)
  const yesOutcome = pickPrimaryBinaryOutcome(outcomes, /^yes$/i, 0)
  const noOutcome = pickPrimaryBinaryOutcome(outcomes, /^no$/i, 1)

  return {
    id: toTrimmedString(market?.id),
    question: toTrimmedString(market?.question, 'Untitled market'),
    slug: toTrimmedString(market?.slug),
    startDate: toTrimmedString(market?.startDate),
    endDate: toTrimmedString(market?.endDate),
    volume24hr: toFiniteNumber(market?.volume24hr, market?.volumeNum),
    volume: toFiniteNumber(market?.volume, market?.volumeNum),
    liquidity: toFiniteNumber(
      market?.liquidityClob,
      market?.liquidityNum ?? market?.liquidity,
    ),
    bestBid: toFiniteNumber(market?.bestBid),
    bestAsk: toFiniteNumber(market?.bestAsk),
    lastTradePrice: toFiniteNumber(market?.lastTradePrice),
    outcomes,
    yesLabel: yesOutcome?.label ?? 'Yes',
    yesPrice: Math.max(
      0,
      Math.min(
        1,
        toFiniteNumber(yesOutcome?.price, market?.lastTradePrice),
      ),
    ),
    noLabel: noOutcome?.label ?? 'No',
    noPrice: Math.max(
      0,
      Math.min(
        1,
        toFiniteNumber(
          noOutcome?.price,
          1 - toFiniteNumber(yesOutcome?.price, market?.lastTradePrice),
        ),
      ),
    ),
  }
}

function sortMarketsChronologically(markets = []) {
  return [...markets].sort((leftMarket, rightMarket) => {
    const leftEndDateMs = parseDateMs(leftMarket?.endDate)
    const rightEndDateMs = parseDateMs(rightMarket?.endDate)

    if (leftEndDateMs !== rightEndDateMs) {
      return (leftEndDateMs ?? Number.POSITIVE_INFINITY) -
        (rightEndDateMs ?? Number.POSITIVE_INFINITY)
    }

    return toTrimmedString(leftMarket?.id).localeCompare(
      toTrimmedString(rightMarket?.id),
    )
  })
}

function buildTimelineDistribution(markets = [], eventId = '') {
  const chronologicalMarkets = sortMarketsChronologically(markets).filter(
    (market) => parseDateMs(market?.endDate) !== null,
  )

  if (!chronologicalMarkets.length) {
    return null
  }

  const segments = []
  let previousCumulativeProbability = 0
  let previousEndDate = ''

  chronologicalMarkets.forEach((market) => {
    const cumulativeProbability = Math.max(
      previousCumulativeProbability,
      Math.min(1, toFiniteNumber(market?.yesPrice)),
    )
    const probability = Math.max(
      0,
      cumulativeProbability - previousCumulativeProbability,
    )

    segments.push({
      id: market.id,
      type: 'dated-market',
      marketId: market.id,
      marketQuestion: market.question,
      startDate: previousEndDate,
      endDate: market.endDate,
      probability,
      cumulativeProbability,
      volume24hr: market.volume24hr,
      volume: market.volume,
      liquidity: market.liquidity,
      yesPrice: market.yesPrice,
      noPrice: market.noPrice,
    })

    previousCumulativeProbability = cumulativeProbability
    previousEndDate = market.endDate
  })

  const remainingProbability = Math.max(
    0,
    1 - previousCumulativeProbability,
  )

  if (remainingProbability > 0.0005) {
    segments.push({
      id: `${eventId || chronologicalMarkets[chronologicalMarkets.length - 1].id}-later`,
      type: 'residual',
      marketId: '',
      marketQuestion: 'Later or unresolved',
      startDate: previousEndDate,
      endDate: '',
      probability: remainingProbability,
      cumulativeProbability: 1,
      volume24hr: 0,
      volume: 0,
      liquidity: 0,
      yesPrice: 0,
      noPrice: 0,
    })
  }

  return {
    kind: 'cumulative-date-markets',
    datedMarketCount: chronologicalMarkets.length,
    finalCumulativeProbability: previousCumulativeProbability,
    segments,
  }
}

export function normalizePredictionEvent(
  event,
  category = PREDICTION_MARKET_CATEGORIES[0],
) {
  const activeMarkets = sortMarketsByDisplayPriority(
    Array.isArray(event?.markets)
      ? event.markets.filter(
        (market) =>
          market?.active &&
            !market?.closed &&
            !market?.archived &&
            toFiniteNumber(market?.volume24hr, market?.volumeNum) > 0,
      )
      : [],
  )

  if (!activeMarkets.length) {
    return null
  }

  const primaryMarket = normalizePredictionMarket(activeMarkets[0])
  const normalizedMarkets = activeMarkets
    .map(normalizePredictionMarket)
    .filter((market) => market.id)
  const timelineDistribution = buildTimelineDistribution(
    normalizedMarkets,
    toTrimmedString(event?.id, primaryMarket.id),
  )

  return {
    id: toTrimmedString(event?.id, toTrimmedString(primaryMarket?.id)),
    categoryKey: category.key,
    categoryLabel: category.label,
    eventTitle: toTrimmedString(event?.title, 'Untitled event'),
    eventSlug: toTrimmedString(event?.slug, toTrimmedString(primaryMarket?.slug)),
    description: toTrimmedString(
      event?.description,
      toTrimmedString(primaryMarket?.description),
    ),
    image: toTrimmedString(event?.image, toTrimmedString(primaryMarket?.image)),
    icon: toTrimmedString(event?.icon, toTrimmedString(primaryMarket?.icon)),
    volume24hr: toFiniteNumber(
      event?.volume24hr,
      primaryMarket?.volume24hr,
    ),
    volume: toFiniteNumber(event?.volume, primaryMarket?.volumeNum),
    openInterest: toFiniteNumber(event?.openInterest),
    liquidity: toFiniteNumber(event?.liquidityClob, event?.liquidity),
    commentCount: Math.max(0, toFiniteNumber(event?.commentCount)),
    startDate: toTrimmedString(event?.startDate, toTrimmedString(primaryMarket?.startDate)),
    endDate: toTrimmedString(event?.endDate, toTrimmedString(primaryMarket?.endDate)),
    tags: normalizePolymarketTags(event?.tags),
    eventUrl: toTrimmedString(event?.slug)
      ? `https://polymarket.com/event/${encodeURIComponent(event.slug)}`
      : '',
    activeMarketCount: normalizedMarkets.length,
    markets: sortMarketsChronologically(normalizedMarkets),
    timelineDistribution,
    primaryMarket,
  }
}

export function createPolymarketClient({
  httpClient = axios,
  logger = console,
} = {}) {
  const fetchCategoryPayload = async ({
    category,
    limit,
  }) => {
    let lastError = null

    for (const order of POLYMARKET_EVENT_ORDER_CANDIDATES) {
      try {
        return await httpClient.get(`${POLYMARKET_GAMMA_BASE_URL}/events`, {
          params: {
            tag_id: category.tagId,
            limit,
            active: true,
            closed: false,
            archived: false,
            order,
            ascending: false,
          },
          timeout: 15_000,
          headers: {
            'User-Agent': 'earth-app-predictions-proxy',
          },
        })
      } catch (error) {
        lastError = error

        if (!isInvalidOrderFieldError(error)) {
          throw error
        }
      }
    }

    throw lastError ?? new Error('Unable to fetch Polymarket events.')
  }

  return {
    async fetchPredictionMarkets({
      limitPerCategory = 12,
    } = {}) {
      const resolvedLimit = Math.max(1, Math.min(24, Number(limitPerCategory) || 12))
      const categoryPayloads = await Promise.all(
        PREDICTION_MARKET_CATEGORIES.map(async (category) => {
          const response = await fetchCategoryPayload({
            category,
            limit: resolvedLimit,
          })
          const events = Array.isArray(response.data)
            ? response.data
              .map((event) => normalizePredictionEvent(event, category))
              .filter(Boolean)
            : []

          return {
            ...category,
            events: events.slice(0, resolvedLimit),
          }
        }),
      )

      return {
        source: 'polymarket',
        generatedAt: Date.now(),
        categories: categoryPayloads,
      }
    },

    logFailure(error) {
      logger.error?.('Unable to fetch Polymarket prediction markets.', error)
    },
  }
}
