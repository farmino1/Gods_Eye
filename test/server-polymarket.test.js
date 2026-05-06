import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PREDICTION_MARKET_CATEGORIES,
  createPolymarketClient,
  normalizePredictionEvent,
  parseJsonArrayField,
} from '../server/polymarket.js'

test('parseJsonArrayField safely parses JSON array strings', () => {
  assert.deepEqual(parseJsonArrayField('["Yes","No"]'), ['Yes', 'No'])
  assert.deepEqual(parseJsonArrayField(''), [])
  assert.deepEqual(parseJsonArrayField('not-json'), [])
})

test('normalizePredictionEvent preserves active date markets and builds a 100% timeline distribution', () => {
  const normalizedEvent = normalizePredictionEvent(
    {
      id: 'event-1',
      title: 'Trump announces end of military operations against Iran by ...?',
      slug: 'trump-announces-end-of-military-operations-against-iran-by',
      description: 'Example event',
      image: 'https://example.test/event.png',
      volume24hr: 8_128_194.46,
      volume: 63_696_151.96,
      openInterest: 13_834_934.27,
      liquidityClob: 868_092.24,
      commentCount: 5_761,
      startDate: '2026-01-11T20:43:43.866901Z',
      endDate: '2026-12-31T00:00:00Z',
      tags: [
        {
          id: '100265',
          label: 'Geopolitics',
          slug: 'geopolitics',
        },
      ],
      markets: [
        {
          id: 'market-apr-30',
          question: 'Trump announces end of military operations against Iran by Apr 30?',
          slug: 'trump-announces-end-of-military-operations-against-iran-by-apr-30',
          outcomes: '["Yes", "No"]',
          outcomePrices: '["0.57", "0.43"]',
          active: true,
          closed: false,
          archived: false,
          volume24hr: 1_916_332,
          volumeNum: 7_376_777.48,
          liquidityClob: 174_842.35,
          bestBid: 0.56,
          bestAsk: 0.58,
          lastTradePrice: 0.57,
          endDate: '2026-04-30T00:00:00Z',
        },
        {
          id: 'market-apr-7',
          question: 'Trump announces end of military operations against Iran by Apr 7?',
          slug: 'trump-announces-end-of-military-operations-against-iran-by-apr-7',
          outcomes: '["Yes", "No"]',
          outcomePrices: '["0.13", "0.87"]',
          active: true,
          closed: false,
          archived: false,
          volume24hr: 793_058,
          volumeNum: 1_100_000,
          liquidityClob: 120_000,
          bestBid: 0.12,
          bestAsk: 0.13,
          lastTradePrice: 0.13,
          endDate: '2026-04-07T00:00:00Z',
        },
        {
          id: 'market-jun-30',
          question: 'Trump announces end of military operations against Iran by Jun 30?',
          slug: 'trump-announces-end-of-military-operations-against-iran-by-jun-30',
          outcomes: '["Yes", "No"]',
          outcomePrices: '["0.81", "0.19"]',
          active: true,
          closed: false,
          archived: false,
          volume24hr: 810_530,
          volumeNum: 2_250_000,
          liquidityClob: 210_000,
          bestBid: 0.8,
          bestAsk: 0.81,
          lastTradePrice: 0.81,
          endDate: '2026-06-30T00:00:00Z',
        },
        {
          id: 'market-apr-15',
          question: 'Trump announces end of military operations against Iran by Apr 15?',
          slug: 'trump-announces-end-of-military-operations-against-iran-by-apr-15',
          outcomes: '["Yes", "No"]',
          outcomePrices: '["0.28", "0.72"]',
          active: true,
          closed: false,
          archived: false,
          volume24hr: 1_276_196,
          volumeNum: 2_500_000,
          liquidityClob: 142_500,
          bestBid: 0.27,
          bestAsk: 0.28,
          lastTradePrice: 0.28,
          endDate: '2026-04-15T00:00:00Z',
        },
        {
          id: 'market-inactive',
          question: 'Inactive market',
          outcomes: '["Yes", "No"]',
          outcomePrices: '["0", "1"]',
          active: false,
          closed: false,
          archived: false,
          volume24hr: 99_999_999,
        },
      ],
    },
    PREDICTION_MARKET_CATEGORIES[1],
  )

  assert.equal(normalizedEvent.categoryKey, 'geopolitics')
  assert.equal(
    normalizedEvent.eventTitle,
    'Trump announces end of military operations against Iran by ...?',
  )
  assert.equal(normalizedEvent.activeMarketCount, 4)
  assert.deepEqual(
    normalizedEvent.markets.map((market) => market.id),
    ['market-apr-7', 'market-apr-15', 'market-apr-30', 'market-jun-30'],
  )
  assert.equal(
    normalizedEvent.primaryMarket.question,
    'Trump announces end of military operations against Iran by Apr 30?',
  )
  assert.equal(normalizedEvent.primaryMarket.yesLabel, 'Yes')
  assert.equal(normalizedEvent.primaryMarket.yesPrice, 0.57)
  assert.equal(normalizedEvent.primaryMarket.noLabel, 'No')
  assert.equal(normalizedEvent.primaryMarket.noPrice, 0.43)
  assert.equal(
    normalizedEvent.timelineDistribution.kind,
    'cumulative-date-markets',
  )
  assert.equal(normalizedEvent.timelineDistribution.datedMarketCount, 4)
  assert.deepEqual(
    normalizedEvent.timelineDistribution.segments.map((segment) =>
      Number(segment.probability.toFixed(2))),
    [0.13, 0.15, 0.29, 0.24, 0.19],
  )
  assert.equal(
    normalizedEvent.timelineDistribution.segments[0].endDate,
    '2026-04-07T00:00:00Z',
  )
  assert.equal(
    normalizedEvent.timelineDistribution.segments[1].startDate,
    '2026-04-07T00:00:00Z',
  )
  assert.equal(
    normalizedEvent.timelineDistribution.segments[4].type,
    'residual',
  )
  assert.equal(
    normalizedEvent.eventUrl,
    'https://polymarket.com/event/trump-announces-end-of-military-operations-against-iran-by',
  )
})

test('createPolymarketClient fetches category event groups from Gamma', async () => {
  const requests = []
  const httpClient = {
    async get(url, options = {}) {
      requests.push({
        url,
        params: options.params,
      })

      return {
        data: [
          {
            id: options.params.tag_slug,
            title: `${options.params.tag_slug} event`,
            slug: `${options.params.tag_slug}-event`,
            markets: [
              {
                id: `${options.params.tag_slug}-market`,
                question: `${options.params.tag_slug} market`,
                outcomes: '["Yes", "No"]',
                outcomePrices: '["0.42", "0.58"]',
                active: true,
                closed: false,
                archived: false,
                volume24hr: 123_456,
                volumeNum: 654_321,
                liquidityClob: 50_000,
                lastTradePrice: 0.42,
              },
            ],
          },
        ],
      }
    },
  }

  const client = createPolymarketClient({
    httpClient,
    logger: {
      error() {},
    },
  })
  const payload = await client.fetchPredictionMarkets({
    limitPerCategory: 4,
  })

  assert.equal(payload.source, 'polymarket')
  assert.equal(payload.categories.length, 2)
  assert.equal(requests.length, 2)
  assert.equal(requests[0].params.limit, 4)
  assert.equal(requests[0].params.tag_id, '2')
  assert.equal(requests[0].params.active, true)
  assert.equal(requests[0].params.order, 'volume24hr')
  assert.equal(payload.categories[0].events[0].primaryMarket.yesPrice, 0.42)
  assert.equal(payload.categories[0].events[0].markets.length, 1)
})

test('createPolymarketClient retries with fallback order fields when Gamma rejects one', async () => {
  const requests = []
  const httpClient = {
    async get(url, options = {}) {
      requests.push({
        url,
        params: options.params,
      })

      if (options.params.order === 'volume24hr') {
        const error = new Error('validation')
        error.response = {
          status: 400,
          data: {
            error: 'order fields are not valid',
          },
        }
        throw error
      }

      return {
        data: [
          {
            id: 'event-1',
            title: 'Fallback order event',
            slug: 'fallback-order-event',
            markets: [
              {
                id: 'market-1',
                question: 'Fallback order market',
                outcomes: '["Yes", "No"]',
                outcomePrices: '["0.42", "0.58"]',
                active: true,
                closed: false,
                archived: false,
                volume24hr: 123_456,
                volumeNum: 654_321,
                liquidityClob: 50_000,
                lastTradePrice: 0.42,
              },
            ],
          },
        ],
      }
    },
  }

  const client = createPolymarketClient({
    httpClient,
    logger: {
      error() {},
    },
  })
  const payload = await client.fetchPredictionMarkets({
    limitPerCategory: 1,
  })

  assert.equal(payload.categories.length, 2)
  assert.ok(requests.some((request) => request.params.order === 'volume24hr'))
  assert.ok(requests.some((request) => request.params.order === 'volume_24hr'))
})
