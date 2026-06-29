// SourceSelect.tsx — top-bar data-source regime switcher. Replaces the old read-only
// SOURCE telemetry text with an interactive popover. Honest by construction: it shows
// each regime's LST provenance, date window, and an "active vs pending" status dot, and
// never implies a fake second model (see lib/sources.ts). Selecting a regime clamps the
// app's date pickers to that regime's window via useActiveSource().

import { useEffect, useRef, useState } from 'react'
import { useAppDispatch, useAppState } from '../../state/useAppState'
import { deriveSources, activeSourceKey, type DataSource } from '../../lib/sources'

export default function SourceSelect() {
  const { meta, source } = useAppState()
  const dispatch = useAppDispatch()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  if (!meta) return null
  const sources = deriveSources(meta)
  const activeKey = source ?? activeSourceKey(meta)
  const active = sources.find((s) => s.key === activeKey) ?? sources[0]

  return (
    <div className="relative flex flex-col" ref={ref}>
      <span className="text-[8px] tracking-[0.2em] text-muted/70">SOURCE</span>
      <button
        onClick={() => setOpen((o) => !o)}
        title={active.note}
        className="inline-flex items-center gap-1.5 font-mono text-[10px] text-ink transition-colors hover:text-saffron"
      >
        <StatusDot status={active.status} />
        <span>{active.lstLabel}</span>
        <span className="text-muted">· {active.dateStart.slice(0, 4)}–{active.dateEnd.slice(0, 4)}</span>
        <span className="text-muted/60">{open ? '▴' : '▾'}</span>
      </button>

      {open && (
        <div className="absolute left-0 top-8 z-50 w-72 rounded-md border border-line bg-panel-2/95 p-1.5 shadow-glow backdrop-blur-md">
          {sources.map((s) => {
            const selected = s.key === activeKey
            return (
              <button
                key={s.key}
                onClick={() => {
                  dispatch({ type: 'SET_SOURCE', source: s.key })
                  setOpen(false)
                }}
                className={`flex w-full flex-col gap-1 rounded px-2 py-2 text-left transition-colors ${
                  selected ? 'bg-isro/10' : 'hover:bg-line/40'
                }`}
              >
                <span className="flex items-center justify-between font-mono text-[10px]">
                  <span className="inline-flex items-center gap-1.5 text-ink">
                    <StatusDot status={s.status} />
                    {s.label}
                  </span>
                  <span className="text-muted">{s.dateStart.slice(0, 4)}–{s.dateEnd.slice(0, 4)}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span
                    className={`rounded px-1 py-0.5 font-mono text-[8px] tracking-[0.12em] ${
                      s.status === 'active'
                        ? 'bg-online/15 text-online'
                        : 'bg-saffron/15 text-saffron'
                    }`}
                  >
                    {s.status === 'active' ? 'ACTIVE' : 'PENDING RETRAIN'}
                  </span>
                  <span className="font-mono text-[8px] text-muted">LST {s.lstLabel}</span>
                </span>
                <span className="text-[9px] leading-snug text-muted">{s.note}</span>
              </button>
            )
          })}
          <p className="px-2 pb-1 pt-1.5 text-[8px] leading-snug text-muted/70">
            One validated model underneath; switching regime clamps the date window and LST
            provenance. Real INSAT-3D activates after its retrain.
          </p>
        </div>
      )}
    </div>
  )
}

function StatusDot({ status }: { status: DataSource['status'] }) {
  const on = status === 'active'
  return (
    <span
      className={`h-2 w-2 rounded-full ${on ? 'bg-online' : 'bg-saffron'}`}
      style={{ boxShadow: on ? '0 0 8px #36d399' : '0 0 8px #ff8a3d' }}
    />
  )
}
