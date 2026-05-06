import { useEffect, useRef, useState } from 'react'
import * as Cesium from 'cesium'
import { searchLocations } from '../services/locationSearch.js'

const SEARCH_DEBOUNCE_MS = 260
const MIN_QUERY_LENGTH = 2
const DEFAULT_FLY_TO_HEIGHT_METERS = 35_000
const MIN_RESULT_LATITUDE_SPAN_DEGREES = 0.08
const MIN_RESULT_LONGITUDE_SPAN_DEGREES = 0.08

function buildFlyToRectangle(result) {
  if (!result?.bbox) {
    return null
  }

  const centerLat = (result.bbox.south + result.bbox.north) * 0.5
  const centerLon = (result.bbox.west + result.bbox.east) * 0.5
  const latitudeSpan = Math.max(
    MIN_RESULT_LATITUDE_SPAN_DEGREES,
    Math.abs(result.bbox.north - result.bbox.south),
  )
  const longitudeSpan = Math.max(
    MIN_RESULT_LONGITUDE_SPAN_DEGREES,
    Math.abs(result.bbox.east - result.bbox.west),
  )

  return Cesium.Rectangle.fromDegrees(
    centerLon - longitudeSpan * 0.5,
    centerLat - latitudeSpan * 0.5,
    centerLon + longitudeSpan * 0.5,
    centerLat + latitudeSpan * 0.5,
  )
}

function flyToSearchResult(viewer, result) {
  if (!viewer || !result) {
    return
  }

  const rectangle = buildFlyToRectangle(result)

  if (rectangle) {
    viewer.camera.flyTo({
      destination: rectangle,
      duration: 1.5,
    })
    return
  }

  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      result.lon,
      result.lat,
      DEFAULT_FLY_TO_HEIGHT_METERS,
    ),
    duration: 1.5,
  })
}

function LocationSearchBar({
  viewer,
  onBeforeFlyToResult,
}) {
  const rootRef = useRef(null)
  const skipNextSearchRef = useRef(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [status, setStatus] = useState('idle')
  const [errorMessage, setErrorMessage] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)

  useEffect(() => {
    const trimmedQuery = query.trim()

    if (trimmedQuery.length < MIN_QUERY_LENGTH) {
      return undefined
    }

    if (skipNextSearchRef.current) {
      skipNextSearchRef.current = false
      return undefined
    }

    let cancelled = false
    const timeoutId = window.setTimeout(() => {
      setStatus('loading')
      setErrorMessage('')

      searchLocations(trimmedQuery)
        .then((nextResults) => {
          if (cancelled) {
            return
          }

          setResults(nextResults)
          setStatus('ready')
          setIsOpen(true)
          setHighlightedIndex(nextResults.length ? 0 : -1)
        })
        .catch((error) => {
          if (cancelled) {
            return
          }

          console.error('Unable to search locations.', error)
          setResults([])
          setStatus('error')
          setErrorMessage('Search unavailable right now.')
          setIsOpen(true)
          setHighlightedIndex(-1)
        })
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [query])

  useEffect(() => {
    function handlePointerDown(event) {
      if (!rootRef.current?.contains(event.target)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
    }
  }, [])

  const selectResult = (result) => {
    if (!result) {
      return
    }

    onBeforeFlyToResult?.(result)
    flyToSearchResult(viewer, result)
    skipNextSearchRef.current = true
    setQuery(result.displayName)
    setIsOpen(false)
  }

  const handleKeyDown = (event) => {
    if (!isOpen && event.key === 'ArrowDown' && results.length) {
      setIsOpen(true)
      setHighlightedIndex(0)
      event.preventDefault()
      return
    }

    if (!isOpen) {
      if (event.key === 'Enter' && results.length) {
        selectResult(results[0])
        event.preventDefault()
      }

      return
    }

    if (event.key === 'ArrowDown') {
      setHighlightedIndex((currentIndex) =>
        Math.min(results.length - 1, Math.max(0, currentIndex + 1)),
      )
      event.preventDefault()
      return
    }

    if (event.key === 'ArrowUp') {
      setHighlightedIndex((currentIndex) =>
        Math.max(0, currentIndex <= 0 ? 0 : currentIndex - 1),
      )
      event.preventDefault()
      return
    }

    if (event.key === 'Escape') {
      setIsOpen(false)
      event.preventDefault()
      return
    }

    if (event.key === 'Enter') {
      const selectedResult =
        highlightedIndex >= 0 ? results[highlightedIndex] : results[0]

      if (selectedResult) {
        selectResult(selectedResult)
        event.preventDefault()
      }
    }
  }

  const shouldShowDropdown =
    isOpen &&
    (
      status === 'loading' ||
      status === 'error' ||
      results.length > 0 ||
      query.trim().length >= MIN_QUERY_LENGTH
    )

  return (
    <div
      ref={rootRef}
      className="pointer-events-auto absolute left-6 top-6 z-20 w-[min(30rem,calc(100vw-3rem))]"
    >
      <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-950/88 shadow-2xl shadow-black/40 backdrop-blur-xl">
        <div className="flex items-center gap-3 px-4 py-3">
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5 shrink-0 text-slate-400"
            aria-hidden="true"
          >
            <circle
              cx="11"
              cy="11"
              r="6"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <path
              d="M16 16L20 20"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeWidth="1.8"
            />
          </svg>

          <input
            type="text"
            value={query}
            onChange={(event) => {
              const nextQuery = event.target.value
              const trimmedQuery = nextQuery.trim()

              skipNextSearchRef.current = false
              setQuery(nextQuery)

              if (trimmedQuery.length < MIN_QUERY_LENGTH) {
                setResults([])
                setStatus('idle')
                setErrorMessage('')
                setHighlightedIndex(-1)
                setIsOpen(false)
                return
              }

              setIsOpen(true)
            }}
            onFocus={() => {
              if (results.length || status === 'error') {
                setIsOpen(true)
              }
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search places"
            className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
            autoComplete="off"
            spellCheck="false"
          />

          {query && (
            <button
              type="button"
              onClick={() => {
                skipNextSearchRef.current = false
                setQuery('')
                setResults([])
                setErrorMessage('')
                setStatus('idle')
                setHighlightedIndex(-1)
                setIsOpen(false)
              }}
              className="rounded-full p-1 text-slate-400 transition hover:bg-white/5 hover:text-white"
              aria-label="Clear search"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                aria-hidden="true"
              >
                <path
                  d="M6 6l12 12M18 6L6 18"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                />
              </svg>
            </button>
          )}
        </div>

        {shouldShowDropdown && (
          <div className="border-t border-white/10 bg-slate-950/96">
            {status === 'loading' && (
              <div className="px-4 py-3 text-sm text-slate-400">
                Searching...
              </div>
            )}

            {status === 'error' && (
              <div className="px-4 py-3 text-sm text-rose-200">
                {errorMessage}
              </div>
            )}

            {status !== 'loading' &&
              status !== 'error' &&
              !results.length &&
              query.trim().length >= MIN_QUERY_LENGTH && (
              <div className="px-4 py-3 text-sm text-slate-400">
                No locations found.
              </div>
            )}

            {!!results.length && (
              <div className="max-h-80 overflow-y-auto py-2">
                {results.map((result, index) => {
                  const isHighlighted = index === highlightedIndex

                  return (
                    <button
                      key={result.id}
                      type="button"
                      onMouseEnter={() => setHighlightedIndex(index)}
                      onClick={() => selectResult(result)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition ${
                        isHighlighted
                          ? 'bg-cyan-400/12'
                          : 'hover:bg-white/5'
                      }`}
                    >
                      <div className="mt-0.5 shrink-0 rounded-full border border-white/10 bg-white/5 p-1.5 text-slate-400">
                        <svg
                          viewBox="0 0 24 24"
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        >
                          <path
                            d="M12 21s6-5.33 6-11a6 6 0 1 0-12 0c0 5.67 6 11 6 11Z"
                            fill="none"
                            stroke="currentColor"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="1.8"
                          />
                          <circle
                            cx="12"
                            cy="10"
                            r="2.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                          />
                        </svg>
                      </div>

                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-white">
                          {result.title}
                        </div>
                        {result.subtitle && (
                          <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">
                            {result.subtitle}
                          </div>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default LocationSearchBar
