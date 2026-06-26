// StatCard.tsx — a telemetry tile with a count-up value, unit, label and accent glow.
// Count-up uses requestAnimationFrame + easeOutCubic; re-runs whenever `value` changes.

import { useEffect, useRef, useState } from 'react'
import { easeOutCubic } from '../../lib/format'

interface Props {
  label: string
  value: number | null
  unit?: string
  digits?: number
  accent?: string // hex/rgb accent for the value + glow
  alert?: boolean // danger styling when a threshold is crossed
  sublabel?: string
}

export default function StatCard({
  label,
  value,
  unit,
  digits = 1,
  accent = '#2b6cff',
  alert = false,
  sublabel,
}: Props) {
  const [display, setDisplay] = useState(0)
  const fromRef = useRef(0)
  const rafRef = useRef<number>()

  useEffect(() => {
    if (value === null || Number.isNaN(value)) return
    const from = fromRef.current
    const to = value
    const start = performance.now()
    const dur = 700
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur)
      setDisplay(from + (to - from) * easeOutCubic(t))
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
      else fromRef.current = to
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [value])

  const color = alert ? '#ff5470' : accent
  const empty = value === null || Number.isNaN(value)

  return (
    <div
      className="relative rounded-lg border border-line bg-panel-2/70 px-4 py-3 backdrop-blur-sm"
      style={{ boxShadow: `inset 0 0 0 1px rgba(43,108,255,0.04), 0 0 22px -10px ${color}` }}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <span
          className="font-mono text-2xl font-semibold tabular-nums"
          style={{ color }}
        >
          {empty ? '—' : display.toFixed(digits)}
        </span>
        {unit && <span className="font-mono text-xs text-muted">{unit}</span>}
      </div>
      {sublabel && (
        <div className="mt-0.5 font-mono text-[10px] text-muted/80">{sublabel}</div>
      )}
      <span
        className="pointer-events-none absolute right-3 top-3 h-1.5 w-1.5 rounded-full"
        style={{ background: color, boxShadow: `0 0 8px ${color}` }}
      />
    </div>
  )
}
