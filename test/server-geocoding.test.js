import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createLocationSearchClient,
  normalizeLocationSearchResult,
} from '../server/geocoding.js'

test('normalizeLocationSearchResult keeps the core location fields', () => {
  assert.deepEqual(
    normalizeLocationSearchResult({
      place_id: 123,
      name: 'London',
      display_name: 'London, Greater London, England, United Kingdom',
      lat: '51.5074456',
      lon: '-0.1277653',
      boundingbox: ['51.28', '51.70', '-0.51', '0.33'],
    }),
    {
      id: '123',
      title: 'London',
      subtitle: 'Greater London, England, United Kingdom',
      displayName: 'London, Greater London, England, United Kingdom',
      lat: 51.5074456,
      lon: -0.1277653,
      bbox: {
        south: 51.28,
        north: 51.7,
        west: -0.51,
        east: 0.33,
      },
    },
  )
})

test('createLocationSearchClient fetches and normalizes search results', async () => {
  const client = createLocationSearchClient({
    httpClient: {
      async get(_url, options) {
        assert.equal(options.params.q, 'Paris')
        assert.equal(options.params.limit, 4)

        return {
          data: [
            {
              place_id: 456,
              display_name: 'Paris, Ile-de-France, Metropolitan France, France',
              lat: '48.8534951',
              lon: '2.3483915',
              boundingbox: ['48.81', '48.90', '2.22', '2.47'],
            },
          ],
        }
      },
    },
  })

  const payload = await client.searchLocations({
    query: 'Paris',
    limit: 4,
  })

  assert.equal(payload.source, 'nominatim')
  assert.equal(payload.query, 'Paris')
  assert.equal(payload.results.length, 1)
  assert.equal(payload.results[0].title, 'Paris')
  assert.equal(payload.results[0].bbox.east, 2.47)
})
