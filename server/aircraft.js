import axios from 'axios'

const OPENSKY_PROVIDER = 'opensky'
const OPENSKY_TOKEN_URL =
  'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token'
const DEFAULT_OPENSKY_STATES_URL = 'https://opensky-network.org/api/states/all'
const AIRCRAFT_FETCH_TIMEOUT_MS = 15_000

function toTrimmedString(value, fallback = '') {
  return typeof value === 'string' ? value.trim() || fallback : fallback
}

function toFiniteNumber(value, fallback = null) {
  const parsedValue = Number(value)

  return Number.isFinite(parsedValue) ? parsedValue : fallback
}

function normalizeTimestampMs(value, fallbackMs = Date.now()) {
  const parsedValue = Number(value)

  if (!Number.isFinite(parsedValue)) {
    return fallbackMs
  }

  return parsedValue >= 1_000_000_000_000
    ? parsedValue
    : parsedValue * 1000
}

export function resolveAircraftProvider() {
  return OPENSKY_PROVIDER
}

export function normalizeOpenSkyPayload(payload) {
  const normalizedTimeMs = normalizeTimestampMs(payload?.time)
  const normalizedStates = Array.isArray(payload?.states)
    ? payload.states.filter(Array.isArray)
    : []

  return {
    provider: OPENSKY_PROVIDER,
    source: OPENSKY_PROVIDER,
    time: Math.floor(normalizedTimeMs / 1000),
    timeMs: normalizedTimeMs,
    states: normalizedStates,
  }
}

export function createAircraftDataClient({
  env = process.env,
  httpClient = axios,
} = {}) {
  let cachedOpenSkyAccessToken = null
  let cachedOpenSkyAccessTokenExpiresAtMs = 0
  let pendingOpenSkyAccessTokenRequest = null

  async function fetchOpenSkyAccessToken() {
    const clientId = toTrimmedString(env.OPENSKY_CLIENT_ID)
    const clientSecret = toTrimmedString(env.OPENSKY_CLIENT_SECRET)

    if (!clientId || !clientSecret) {
      return null
    }

    const nowMs = Date.now()

    if (
      cachedOpenSkyAccessToken &&
      nowMs < cachedOpenSkyAccessTokenExpiresAtMs
    ) {
      return cachedOpenSkyAccessToken
    }

    if (!pendingOpenSkyAccessTokenRequest) {
      const tokenRequestBody = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      })

      pendingOpenSkyAccessTokenRequest = httpClient
        .post(OPENSKY_TOKEN_URL, tokenRequestBody, {
          timeout: AIRCRAFT_FETCH_TIMEOUT_MS,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        })
        .then((tokenResponse) => {
          const accessToken = tokenResponse.data?.access_token
          const expiresInSeconds = Number(tokenResponse.data?.expires_in || 0)

          if (!accessToken) {
            throw new Error('OpenSky token response did not include an access token.')
          }

          cachedOpenSkyAccessToken = accessToken
          cachedOpenSkyAccessTokenExpiresAtMs =
            Date.now() + Math.max(30, expiresInSeconds - 60) * 1000

          return accessToken
        })
        .finally(() => {
          pendingOpenSkyAccessTokenRequest = null
        })
    }

    return pendingOpenSkyAccessTokenRequest
  }

  async function fetchOpenSkyPayload() {
    try {
      const accessToken = await fetchOpenSkyAccessToken()
      const url = toTrimmedString(env.OPENSKY_STATES_URL) || DEFAULT_OPENSKY_STATES_URL
      const response = await httpClient.get(url, {
        timeout: AIRCRAFT_FETCH_TIMEOUT_MS,
        headers: {
          'User-Agent': 'earth-app-aircraft-proxy',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
      })

      return normalizeOpenSkyPayload(response.data)
    } catch (error) {
      // If the upstream provider fails (rate limiting, network error,
      // or invalid credentials), return a safe empty payload rather than
      // throwing so the proxy can continue serving the app (possibly with
      // cached or empty data).
      console.warn('OpenSky fetch failed; returning empty aircraft payload.', error)

      return {
        provider: OPENSKY_PROVIDER,
        source: OPENSKY_PROVIDER,
        time: Math.floor(Date.now() / 1000),
        timeMs: Date.now(),
        states: [],
      }
    }
  }

  return {
    resolveProvider() {
      return resolveAircraftProvider(env)
    },

    async fetchAircraftPayload() {
      return fetchOpenSkyPayload()
    },
  }
}