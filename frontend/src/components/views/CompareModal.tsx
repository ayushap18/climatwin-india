// CompareModal.tsx — side-by-side comparison of two forecasters for the same date/variable.
// Fetches both forecasts, renders MODEL A | MODEL B | DIFF as colored grids at a chosen lead
// day, so you can see where two models disagree. Pure overlay; closes on backdrop/Esc.

import { useEffect, useMemo, useState } from 'react'
import { getForecast } from '../../api/endpoints'
import type { ForecastResp, VarName } from '../../api/types'
import { colorForScale, colorForValue } from '../../lib/colormaps'
import { COLORS } from '../../theme'

export default function CompareModal({
  date, variable, horizon, range, models, defaultModel, contrast, onClose,
}: {
  date: string
  variable: VarName
  horizon: number
  range: [number, number]
  models: string[]
  defaultModel: string
  contrast: number
  onClose: () => void
}) {
  const [a, setA] = useState(defaultModel)
  const [b, setB] = useState(models.find((m) => m !== defaultModel) ?? models[0])
  const [lead, setLead] = useState(1)
  const [fa, setFa] = useState<ForecastResp | null>(null)
  const [fb, setFb] = useState<ForecastResp | null>(null)

  useEffect(() => {
    let on = true
    getForecast({ date, horizon, model: a }).then((r) => on && setFa(r)).catch(() => on && setFa(null))
    return () => { on = false }
  }, [a, date, horizon])
  useEffect(() => {
    let on = true
    getForecast({ date, horizon, model: b }).then((r) => on && setFb(r)).catch(() => on && setFb(null))
    return () => { on = false }
  }, [b, date, horizon])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const fieldA = fa?.days[lead - 1]?.fields[variable] ?? null
  const fieldB = fb?.days[lead - 1]?.fields[variable] ?? null
  const diff = useMemo(
    () => (fieldA && fieldB ? fieldA.map((row, i) => row.map((v, j) => v - (fieldB[i]?.[j] ?? v))) : null),
    [fieldA, fieldB],
  )
  const dmax = useMemo(() => (diff ? Math.max(0.5, ...diff.flat().map((x) => Math.abs(x))) : 1), [diff])
  const unit = fa?.units[variable] ?? ''

  return (
    <div className="fixed inset-0 z-[900] flex items-center justify-center bg-black/55 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[min(820px,94vw)] rounded-xl border border-line bg-panel/95 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <div className="font-mono text-[11px] tracking-[0.18em] text-ink">
            COMPARE MODELS · {variable.toUpperCase()} · +{lead}d · {date}
          </div>
          <button onClick={onClose} className="font-mono text-[11px] text-muted hover:text-danger">✕ close</button>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <ModelPick label="MODEL A" value={a} onChange={setA} models={models} color={COLORS.isro} />
          <ModelPick label="MODEL B" value={b} onChange={setB} models={models} color={COLORS.saffron} />
        </div>

        <div className="flex flex-wrap items-start justify-center gap-4">
          <Panel title={a.toUpperCase()} accent={COLORS.isro}>
            {fieldA ? <CmpGrid field={fieldA} color={(v) => colorForValue(variable, v, range, contrast)} /> : <Loading />}
          </Panel>
          <Panel title={b.toUpperCase()} accent={COLORS.saffron}>
            {fieldB ? <CmpGrid field={fieldB} color={(v) => colorForValue(variable, v, range, contrast)} /> : <Loading />}
          </Panel>
          <Panel title={`DIFF (A−B) · ±${dmax.toFixed(1)}${unit}`} accent={COLORS.online}>
            {diff ? <CmpGrid field={diff} color={(v) => colorForScale(v + dmax, [0, 2 * dmax], 'diff', contrast)} /> : <Loading />}
          </Panel>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <span className="font-mono text-[10px] tracking-[0.12em] text-muted">LEAD</span>
          <input
            type="range" min={1} max={horizon} value={lead}
            onChange={(e) => setLead(Number(e.target.value))}
            className="ct-range flex-1"
          />
          <span className="w-12 text-right font-mono text-[11px] text-saffron tabular-nums">+{lead}d</span>
        </div>
      </div>
    </div>
  )
}

function ModelPick({ label, value, onChange, models, color }: {
  label: string; value: string; onChange: (m: string) => void; models: string[]; color: string
}) {
  return (
    <div>
      <div className="mb-1 font-mono text-[9px] tracking-[0.14em]" style={{ color }}>{label}</div>
      <div className="flex flex-wrap gap-1">
        {models.map((m) => (
          <button
            key={m}
            onClick={() => onChange(m)}
            className={`rounded border px-1.5 py-1 font-mono text-[9px] tracking-[0.04em] transition-colors ${
              value === m ? 'border-ink/40 bg-panel-2 text-ink' : 'border-line text-muted hover:text-ink'
            }`}
          >
            {m.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  )
}

function Panel({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="rounded-md" style={{ outline: `1px solid ${COLORS.line}` }}>{children}</div>
      <div className="font-mono text-[9px] tracking-[0.08em]" style={{ color: accent }}>{title}</div>
    </div>
  )
}

function CmpGrid({ field, color }: { field: number[][]; color: (v: number) => string }) {
  const w = 210
  const rows = field.length
  const cols = field[0]?.length ?? 1
  const cell = w / cols
  const h = cell * rows
  const gap = 1
  return (
    <svg width={w} height={h} className="block">
      {field.map((row, i) =>
        row.map((val, j) => (
          <rect key={`${i}-${j}`} x={j * cell + gap / 2} y={(rows - 1 - i) * cell + gap / 2}
            width={cell - gap} height={cell - gap} rx={1.5} fill={color(val)} />
        )),
      )}
    </svg>
  )
}

function Loading() {
  return <div className="ct-skeleton" style={{ width: 210, height: 145 }} />
}
