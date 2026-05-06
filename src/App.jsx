import { Suspense, lazy, useState } from 'react'
import LayerControls from './components/LayerControls'
import SelectedSatelliteCard from './components/SelectedSatelliteCard'
import Timeline from './components/Timeline'

const Globe = lazy(() => import('./components/Globe'))
const PredictionsPage = lazy(() => import('./components/PredictionsPage'))

const pageOptions = [
  {
    key: 'globe',
    label: 'Globe',
  },
  {
    key: 'predictions',
    label: 'Predictions',
  },
]

function App() {
  const [activePage, setActivePage] = useState('globe')

  return (
    <div className="flex h-screen flex-col bg-black text-white">
      <div className="flex min-h-0 flex-1">
        <aside className="flex min-h-0 w-80 shrink-0 flex-col gap-6 overflow-y-auto border-r border-white/10 bg-slate-950/70 p-6 backdrop-blur-xl">
          <div className="flex rounded-2xl border border-white/10 bg-white/5 p-1">
            {pageOptions.map((page) => {
              const isActive = activePage === page.key

              return (
                <button
                  key={page.key}
                  type="button"
                  onClick={() => setActivePage(page.key)}
                  className={`flex-1 rounded-xl px-3 py-2 text-sm font-medium transition ${
                    isActive
                      ? 'bg-cyan-400/15 text-cyan-100'
                      : 'text-slate-300 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  {page.label}
                </button>
              )
            })}
          </div>

          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">
              {activePage === 'globe'
                ? "God's Eye"
                : 'Prediction Markets'}
            </h1>
          </div>

          {activePage === 'globe' ? (
            <>
              <LayerControls />
              <SelectedSatelliteCard />
            </>
          ) : null}
        </aside>

        <main className="relative min-h-0 flex-1 overflow-hidden">
          {activePage === 'globe' ? (
            <>
              <Suspense
                fallback={
                  <div className="flex h-full items-center justify-center bg-slate-950 text-sm text-slate-300">
                    Preparing the globe...
                  </div>
                }
              >
                <Globe />
              </Suspense>
            </>
          ) : (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center bg-slate-950 text-sm text-slate-300">
                  Loading live prediction markets...
                </div>
              }
            >
              <PredictionsPage />
            </Suspense>
          )}
        </main>
      </div>

      {activePage === 'globe' && (
        <footer className="flex h-32 shrink-0 items-center border-t border-white/10 bg-slate-950/80 px-4 text-sm text-slate-400 backdrop-blur-xl">
          <div className="w-full">
            <Timeline />
          </div>
        </footer>
      )}
    </div>
  )
}

export default App
