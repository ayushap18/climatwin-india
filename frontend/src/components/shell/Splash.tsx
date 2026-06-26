// Splash.tsx — boot screen shown until /health + /meta resolve. Types out a short
// boot log and fills a saffron progress bar. On boot error, shows the message + hint.

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useAppState } from '../../state/useAppState'

const LOG_LINES = [
  '> initializing ClimaTwin India core',
  '> linking reality⟷twin bus',
  '> GET /health  ...',
  '> GET /meta    ...',
  '> warming state + forecast caches',
  '> twin online',
]

export default function Splash() {
  const { bootStatus, bootError } = useAppState()
  const [shown, setShown] = useState(1)

  useEffect(() => {
    if (shown >= LOG_LINES.length) return
    const t = window.setTimeout(() => setShown((n) => n + 1), 280)
    return () => window.clearTimeout(t)
  }, [shown])

  const done = bootStatus === 'ready'
  const errored = bootStatus === 'error'
  const progress = errored ? 100 : done ? 100 : Math.min(90, shown * 16)

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-bg">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-[min(520px,86vw)]"
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-md border border-isro/40 bg-panel font-mono text-saffron shadow-glow">
            CT
          </div>
          <div>
            <div className="font-mono text-sm tracking-[0.3em] text-ink">CLIMATWIN INDIA</div>
            <div className="font-mono text-[10px] tracking-[0.25em] text-muted">
              DIGITAL TWIN · MISSION CONTROL
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-line bg-panel/80 p-4 font-mono text-xs">
          {LOG_LINES.slice(0, shown).map((l, i) => (
            <div key={i} className="text-muted">
              {l}
              {i === 2 && (done || shown > 3) ? <span className="text-online"> ok</span> : null}
              {i === 3 && (done || shown > 4) ? <span className="text-online"> ok</span> : null}
            </div>
          ))}
          {errored && (
            <div className="mt-2 text-danger">
              ! boot failed: {bootError}
              <div className="mt-1 text-muted">
                is the backend up?  `make serve` on :8000
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-line">
          <motion.div
            className="h-full rounded-full"
            style={{ background: errored ? '#ff5470' : '#ff8a3d' }}
            animate={{ width: `${progress}%` }}
            transition={{ ease: 'easeOut', duration: 0.4 }}
          />
        </div>
      </motion.div>
    </div>
  )
}
