// App.tsx — the shell. TopBar across the top, NavRail on the left, the active view in
// the main region (each view owns its own internal layout, e.g. Overview's main+right
// three-panel split). Splash gates everything until /health + /meta resolve.

import { AnimatePresence, motion } from 'framer-motion'
import ScanlineBg from './components/shell/ScanlineBg'
import Splash from './components/shell/Splash'
import TopBar from './components/shell/TopBar'
import NavRail from './components/shell/NavRail'
import Overview from './components/views/Overview'
import Twin from './components/views/Twin'
import Explore from './components/views/Explore'
import WhatIf from './components/views/WhatIf'
import Validation from './components/views/Validation'
import Downscale from './components/views/Downscale'
import CommandConsole from './components/console/CommandConsole'
import CommandPalette from './components/shell/CommandPalette'
import { useAppState, type ViewId } from './state/useAppState'

const VIEWS: Record<ViewId, () => JSX.Element> = {
  overview: Overview,
  twin: Twin,
  explore: Explore,
  whatif: WhatIf,
  validation: Validation,
  downscale: Downscale,
}

export default function App() {
  const { bootStatus, activeView, theme } = useAppState()

  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme
  }

  if (bootStatus !== 'ready') {
    return (
      <>
        <ScanlineBg />
        <Splash />
      </>
    )
  }

  const ActiveView = VIEWS[activeView]

  return (
    <>
      <ScanlineBg />
      <div className="relative z-10 flex h-screen flex-col text-ink">
        <TopBar />
        <div className="flex min-h-0 flex-1">
          <NavRail />
          <main className="min-w-0 flex-1 overflow-auto">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeView}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="h-full"
              >
                <ActiveView />
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
        <CommandConsole />
      </div>
      <CommandPalette />
    </>
  )
}
