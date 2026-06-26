// SettingsPopover.tsx — global display controls in the TopBar: a grid CONTRAST slider that
// drives every heatmap (Explore/Twin/What-If/Validation/Downscale) and a 3D-globe spin toggle.

import { useEffect, useState } from 'react'
import { useAppDispatch, useAppState } from '../../state/useAppState'

export default function SettingsPopover() {
  const { gridContrast, globeSpin, theme } = useAppState()
  const dispatch = useAppDispatch()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`grid h-8 w-8 place-items-center rounded-md border text-sm transition-colors ${
          open ? 'border-saffron/60 text-saffron' : 'border-line text-muted hover:border-isro/40 hover:text-ink'
        }`}
        aria-label="display settings"
        title="display settings"
      >
        ⚙
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-40 w-60 rounded-lg border border-line bg-panel p-3 shadow-glow">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-muted">Display</div>

            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-[10px] text-muted">THEME</span>
              <div className="flex overflow-hidden rounded-md border border-line">
                {(['dark', 'light'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => dispatch({ type: 'SET_THEME', theme: t })}
                    className={`px-2.5 py-1 font-mono text-[10px] tracking-[0.1em] transition-colors ${
                      theme === t ? 'bg-saffron/15 text-saffron' : 'text-muted hover:text-ink'
                    }`}
                  >
                    {t === 'dark' ? '◐ DARK' : '◑ LIGHT'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between font-mono text-[10px] text-muted">
              <span>GRID CONTRAST</span>
              <span className="text-ink tabular-nums">{gridContrast.toFixed(1)}×</span>
            </div>
            <input
              type="range"
              min={0.4}
              max={2.5}
              step={0.1}
              value={gridContrast}
              onChange={(e) => dispatch({ type: 'SET_CONTRAST', value: Number(e.target.value) })}
              className="ct-range mt-1 w-full"
            />
            <div className="mt-0.5 flex justify-between font-mono text-[8px] text-muted/60">
              <span>flat</span>
              <button
                onClick={() => dispatch({ type: 'SET_CONTRAST', value: 1 })}
                className="text-muted hover:text-ink"
              >
                reset
              </button>
              <span>punchy</span>
            </div>

            <div className="mt-3 flex items-center justify-between">
              <span className="font-mono text-[10px] text-muted">3D GLOBE SPIN</span>
              <button
                onClick={() => dispatch({ type: 'SET_GLOBE_SPIN', on: !globeSpin })}
                className={`grid h-5 w-10 place-items-center rounded-full font-mono text-[8px] ${
                  globeSpin ? 'bg-online/25 text-online' : 'bg-line text-muted'
                }`}
              >
                {globeSpin ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
