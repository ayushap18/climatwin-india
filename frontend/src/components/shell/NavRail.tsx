// NavRail.tsx — the narrow left rail. Icon + label per view; switches activeView.
// DOWNSCALE is hidden when meta.downscale_available === false (true in this env).

import { motion } from 'framer-motion'
import { useAppDispatch, useAppState, type ViewId } from '../../state/useAppState'

interface NavItem {
  id: ViewId
  label: string
  glyph: string
}

const ITEMS: NavItem[] = [
  { id: 'overview', label: 'OVERVIEW', glyph: '◎' },
  { id: 'twin', label: 'TWIN', glyph: '⟳' },
  { id: 'explore', label: 'EXPLORE', glyph: '⬢' },
  { id: 'whatif', label: 'WHAT-IF', glyph: '⤳' },
  { id: 'validation', label: 'VALIDATION', glyph: '✓' },
  { id: 'downscale', label: 'DOWNSCALE', glyph: '⊞' },
]

export default function NavRail() {
  const { activeView, meta } = useAppState()
  const dispatch = useAppDispatch()

  const items = ITEMS.filter(
    (it) => it.id !== 'downscale' || meta?.downscale_available !== false,
  )

  return (
    <nav className="z-10 flex w-[136px] shrink-0 flex-col gap-1 border-r border-line bg-panel/60 p-2 backdrop-blur-sm">
      {items.map((it) => {
        const active = activeView === it.id
        return (
          <button
            key={it.id}
            onClick={() => dispatch({ type: 'SET_VIEW', view: it.id })}
            className={`group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${
              active ? 'bg-panel-2 text-ink' : 'text-muted hover:bg-panel-2/60 hover:text-ink'
            }`}
          >
            {active && (
              <motion.span
                layoutId="nav-active"
                className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-saffron"
                style={{ boxShadow: '0 0 8px #ff8a3d' }}
              />
            )}
            <span
              className={`grid h-7 w-7 place-items-center rounded border text-sm ${
                active ? 'border-isro/50 text-saffron' : 'border-line text-muted'
              }`}
            >
              {it.glyph}
            </span>
            <span className="font-mono text-[10px] tracking-[0.14em]">{it.label}</span>
          </button>
        )
      })}

      {/* Indian-flag tricolor marquee */}
      <div className="mt-auto overflow-hidden rounded-md border border-line bg-bg/60 py-1.5">
        <div className="ct-marquee">
          {[0, 1].map((dup) => (
            <span key={dup} className="inline-flex shrink-0 items-center gap-2 px-2 font-mono text-[10px] font-semibold tracking-[0.18em]">
              {Array.from({ length: 4 }).map((_, i) => (
                <span key={i} className="inline-flex items-center gap-1.5">
                  <span style={{ color: '#FF9933' }}>ISRO</span>
                  <span style={{ color: '#1a8c2e' }}>HACKATHON</span>
                  <span style={{ color: '#1a3aa0' }}>⊛</span>
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>
    </nav>
  )
}
