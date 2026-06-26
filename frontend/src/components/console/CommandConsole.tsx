// CommandConsole.tsx — a docked, collapsible REPL (no xterm). Parses a small command set,
// calls the typed API, and renders COMPACT inline results (tables / sparklines / key-values,
// never raw JSON). Every command also flares the twin loop (ASSIMILATE — the console feeding
// the twin — plus whatever stage the underlying endpoint emits).

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ApiError, twinBus, type TwinStage } from '../../api/client'
import {
  getAnomaly,
  getBrain,
  getDownscale,
  getForecast,
  getState,
  getValidate,
  postWhatIf,
} from '../../api/endpoints'
import type {
  AnomalyResp,
  BrainResp,
  BrainStage,
  BrainStep,
  ForecastResp,
  StateResp,
  ValidateResp,
  WhatIfResp,
} from '../../api/types'
import { COLORS } from '../../theme'
import { prettyDate } from '../../lib/format'

interface Entry {
  id: number
  input: string
  status: 'running' | 'ok' | 'error'
  node?: ReactNode
  message?: string
}

const COMMANDS = ['ai', 'help', 'state', 'forecast', 'whatif', 'validate', 'downscale', 'clear'] as const

let nextId = 1

export default function CommandConsole() {
  const [collapsed, setCollapsed] = useState(true)
  const [input, setInput] = useState('')
  const [entries, setEntries] = useState<Entry[]>([
    { id: nextId++, input: '', status: 'ok', node: <Banner /> },
  ])
  const [history, setHistory] = useState<string[]>([])
  const [anomaly, setAnomaly] = useState<AnomalyResp | null>(null)
  const [anomalyHandled, setAnomalyHandled] = useState(false)
  const histIdx = useRef<number>(-1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!collapsed) inputRef.current?.focus()
  }, [collapsed])
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [entries, collapsed])
  // autonomous scan: surface a recent heat/dryness anomaly on load
  useEffect(() => {
    getAnomaly()
      .then((a) => setAnomaly(a.anomaly ? a : null))
      .catch(() => setAnomaly(null))
  }, [])

  // run the anomaly's suggested investigation through the brain
  function investigate() {
    if (!anomaly?.suggested_question) return
    setCollapsed(false)
    setAnomalyHandled(true)
    submit(anomaly.suggested_question)
  }

  async function submit(raw: string) {
    const cmd = raw.trim()
    if (!cmd) return
    setHistory((h) => [...h, cmd])
    histIdx.current = -1
    if (cmd === 'clear') {
      setEntries([])
      return
    }
    const id = nextId++
    setEntries((e) => [...e, { id, input: cmd, status: 'running' }])
    twinBus.emit('ASSIMILATE') // the console assimilates a command into the twin
    try {
      const node = await execute(cmd)
      setEntries((e) => e.map((x) => (x.id === id ? { ...x, status: 'ok', node } : x)))
    } catch (err) {
      const message =
        err instanceof ApiError ? `[${err.status}] ${err.message}` : (err as Error).message
      setEntries((e) => e.map((x) => (x.id === id ? { ...x, status: 'error', message } : x)))
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      submit(input)
      setInput('')
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (history.length === 0) return
      histIdx.current = histIdx.current < 0 ? history.length - 1 : Math.max(0, histIdx.current - 1)
      setInput(history[histIdx.current] ?? '')
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (histIdx.current < 0) return
      histIdx.current = histIdx.current + 1
      if (histIdx.current >= history.length) {
        histIdx.current = -1
        setInput('')
      } else {
        setInput(history[histIdx.current])
      }
    }
  }

  return (
    <section className="z-20 border-t border-line bg-panel/95 font-mono backdrop-blur-md">
      <div className="flex items-center">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="flex flex-1 items-center gap-2 px-3 py-1.5 text-left text-[11px] tracking-[0.15em] text-muted hover:text-ink"
        >
          <span className="text-saffron">{collapsed ? '▸' : '▾'}</span>
          <span>TWIN CONSOLE</span>
          {collapsed && (
            <span className="text-muted/60">
              — ask the <span className="text-ink">brain</span>
              <span className="ct-blink text-saffron"> ▋</span>
            </span>
          )}
          <span className="ml-auto text-[9px] text-muted/50">
            {collapsed ? 'click to open' : 'brain · forecast · whatif · state · validate · downscale'}
          </span>
        </button>
        {anomaly && !anomalyHandled && <AnomalyChip a={anomaly} onClick={investigate} />}
      </div>

      {!collapsed && (
        <>
          <div ref={scrollRef} className="h-[200px] overflow-y-auto px-3 pb-2 text-[12px] leading-relaxed">
            {entries.map((e) => (
              <div key={e.id} className="mb-1.5">
                {e.input && (
                  <div className="text-muted">
                    <span className="text-saffron">›</span> <span className="text-ink">{e.input}</span>
                  </div>
                )}
                {e.status === 'running' && <span className="text-saffron">running…</span>}
                {e.status === 'error' && <span className="text-danger">{e.message}</span>}
                {e.status === 'ok' && e.node}
              </div>
            ))}
          </div>
          <div
            className="flex items-center gap-2 border-t border-line px-3 py-2"
            onClick={() => inputRef.current?.focus()}
          >
            <span className="text-saffron">›</span>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              spellCheck={false}
              autoComplete="off"
              placeholder="is it a good time to sow if temperature rises 3°C?"
              className="flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-muted/40"
              style={{ caretColor: COLORS.saffron }}
            />
          </div>
        </>
      )}
    </section>
  )
}

// --------------------------------------------------------------------------- //
// command execution -> compact ReactNode
// --------------------------------------------------------------------------- //
async function execute(cmd: string): Promise<ReactNode> {
  const [rawName, ...args] = cmd.split(/\s+/)
  const name = rawName.replace(/^\//, '') // accept /ai, /state, … too
  const num = (s: string | undefined, d: number) => (s === undefined ? d : Number(s))

  // any line that isn't an explicit command is a natural-language question → the brain
  if (!(COMMANDS as readonly string[]).includes(name)) {
    const r = await getBrain(cmd)
    return <BrainTrace r={r} />
  }

  switch (name as (typeof COMMANDS)[number]) {
    case 'ai': {
      const question = args.join(' ').trim()
      if (!question)
        return <span className="text-muted">usage: ai &lt;question&gt; — e.g. ai is it a good time to sow?</span>
      const r = await getBrain(question)
      return <BrainTrace r={r} />
    }
    case 'help':
      return <Banner />
    case 'state': {
      const s = await getState(args[0])
      return <StateResult s={s} />
    }
    case 'forecast': {
      const f = await getForecast({
        date: args[0],
        horizon: args[1] ? Number(args[1]) : undefined,
        model: args[2],
      })
      return <ForecastResult f={f} />
    }
    case 'whatif': {
      const r = await postWhatIf({
        date: args[0],
        delta_temp: num(args[1], 2),
        rain_factor: num(args[2], 1),
        urban_lst: num(args[3], 2),
      })
      return <WhatIfResult r={r} />
    }
    case 'validate': {
      const v = await getValidate()
      return <ValidateResult v={v} />
    }
    case 'downscale': {
      const ds = await getDownscale(args[0], args[1] || 'rainfall')
      return (
        <Line>
          downscale {ds.var} · SR-CNN RMSE {fmtN(ds.srcnn_rmse)} vs bilinear{' '}
          {fmtN(ds.bilinear_rmse)} →{' '}
          <span style={{ color: COLORS.online }}>{fmtN(ds.improvement_pct)}% better</span>
        </Line>
      )
    }
    default:
      return (
        <span className="text-danger">
          unknown command: {name}. try <span className="text-ink">help</span>
        </span>
      )
  }
}

function fmtN(n: number | null | undefined, d = 2) {
  return n == null || Number.isNaN(n) ? '—' : n.toFixed(d)
}

// --------------------------------------------------------------------------- //
// compact result renderers
// --------------------------------------------------------------------------- //
// --------------------------------------------------------------------------- //
// agentic brain: plan trace (staged reveal) → cited answer + caveat
// --------------------------------------------------------------------------- //
// Brain stages → the 5-stage TwinCore bus (SKILL folds into IMPACT; REFUSE is silent).
const STAGE_BUS: Record<BrainStage, TwinStage | null> = {
  MIRROR: 'MIRROR',
  ASSIMILATE: 'ASSIMILATE',
  SIMULATE: 'SIMULATE',
  PERTURB: 'PERTURB',
  SKILL: 'IMPACT',
  IMPACT: 'IMPACT',
  REFUSE: null,
}
const STAGE_COLOR: Record<BrainStage, string> = {
  MIRROR: COLORS.isro,
  ASSIMILATE: COLORS.online,
  SIMULATE: COLORS.saffron,
  PERTURB: COLORS.saffron,
  SKILL: COLORS.isro,
  IMPACT: COLORS.online,
  REFUSE: COLORS.danger,
}
const STEP_DELAY = 480 // ms between step reveals — gives the "thinking" cadence

function AnomalyChip({ a, onClick }: { a: AnomalyResp; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={a.message}
      className="mr-3 flex shrink-0 items-center gap-1.5 rounded-full border border-danger/40 bg-danger/10 px-2.5 py-1 text-[10px] tracking-[0.1em] text-danger hover:bg-danger/20"
    >
      <span className="ct-blink">●</span>
      {(a.kind ?? 'anomaly').toUpperCase()} {a.date} — investigate?
    </button>
  )
}

function BrainTrace({ r }: { r: BrainResp }) {
  const [revealed, setRevealed] = useState(0)
  const [done, setDone] = useState(false)

  useEffect(() => {
    setRevealed(0)
    setDone(false)
    const timers: number[] = []
    r.plan.forEach((step, i) => {
      timers.push(
        window.setTimeout(() => {
          setRevealed(i + 1)
          const bus = STAGE_BUS[step.stage] // flare the matching TwinCore node live
          if (bus) twinBus.emit(bus)
          if (i === r.plan.length - 1)
            timers.push(window.setTimeout(() => setDone(true), STEP_DELAY))
        }, i * STEP_DELAY),
      )
    })
    return () => timers.forEach((t) => clearTimeout(t))
  }, [r])

  return (
    <div className="text-ink/90">
      <div className="mb-1 flex items-center gap-2">
        <span className="shrink-0 rounded bg-saffron/15 px-1.5 py-0.5 text-[9px] tracking-[0.15em] text-saffron">
          BRAIN
        </span>
        <span className="text-[9px] uppercase tracking-[0.1em] text-muted/70">
          {r.refused ? 'refused · out of scope' : `${r.intent} · ${r.plan.length}-step plan`}
        </span>
      </div>

      {/* the plan, revealed step-by-step */}
      <div className="space-y-0.5 border-l border-line pl-2.5">
        {r.plan.map((step, i) => (
          <BrainStepRow
            key={i}
            step={step}
            shown={i < revealed}
            active={i === revealed - 1 && !done}
          />
        ))}
      </div>

      {/* the grounded, cited answer + honest caveat, once the trace lands */}
      {done && (
        <div className="mt-1.5">
          <CitedAnswer text={r.answer} />
          {r.caveat && r.caveat !== '—' && (
            <div className="mt-1 flex items-start gap-1 text-[10px] leading-snug text-muted/70">
              <span className="shrink-0 text-saffron/70">⚠</span>
              <span className="italic">{r.caveat}</span>
            </div>
          )}
          <div className="mt-0.5 font-mono text-[9px] text-muted/50">
            grounded · {r.provider}
            {r.citations.length ? ` · ${r.citations.length} citation${r.citations.length > 1 ? 's' : ''}` : ''}
          </div>
        </div>
      )}
    </div>
  )
}

function BrainStepRow({ step, shown, active }: { step: BrainStep; shown: boolean; active: boolean }) {
  const color = STAGE_COLOR[step.stage]
  return (
    <div
      className="flex items-center gap-2 transition-opacity duration-300"
      style={{ opacity: shown ? 1 : 0.12 }}
    >
      <span
        className="w-[74px] shrink-0 rounded px-1 py-0.5 text-center text-[8px] tracking-[0.12em]"
        style={{ color, border: `1px solid ${color}33` }}
      >
        {step.stage}
      </span>
      <span className="flex-1 truncate text-[11px] text-ink/80">{step.label}</span>
      <span className="w-3 shrink-0 text-center text-[11px]">
        {!shown ? (
          <span className="text-muted/40">○</span>
        ) : active ? (
          <span className="ct-blink text-saffron">▸</span>
        ) : step.status === 'error' ? (
          <span className="text-danger">✕</span>
        ) : (
          <span className="text-online">✓</span>
        )}
      </span>
    </div>
  )
}

// render the answer, styling each [tool:field] grounding citation as a subtle chip
function CitedAnswer({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\])/g)
  return (
    <div className="leading-relaxed text-ink/90">
      {parts.map((p, i) =>
        /^\[[^\]]+\]$/.test(p) ? (
          <span
            key={i}
            className="mx-0.5 inline-block rounded bg-isro/10 px-1 align-middle font-mono text-[9px] text-isro"
          >
            {p.slice(1, -1)}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </div>
  )
}

function Banner() {
  return (
    <div className="text-muted">
      <span className="text-ink">ClimaTwin console.</span> ask the brain (or type a command):
      <div className="mt-1 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        <Cmd k="<question>" d="agentic brain: plan → tools → cited answer" />
        <Cmd k="state <date>" d="observed twin state + impacts" />
        <Cmd k="forecast <date> [h] [model]" d="roll-forward + sowing" />
        <Cmd k="whatif <date> [dT] [rain×] [urb]" d="perturb + impact deltas" />
        <Cmd k="validate" d="baseline-relative skill" />
        <Cmd k="downscale [date] [var]" d="SR-CNN vs bilinear" />
        <Cmd k="clear" d="clear scrollback" />
      </div>
    </div>
  )
}

function Cmd({ k, d }: { k: string; d: string }) {
  return (
    <div>
      <span className="text-saffron">{k}</span> <span className="text-muted/70">— {d}</span>
    </div>
  )
}

function Line({ children }: { children: ReactNode }) {
  return <div className="text-ink/90">{children}</div>
}

function StateResult({ s }: { s: StateResp }) {
  const i = s.impacts
  return (
    <Line>
      <span className="text-muted">state</span> {prettyDate(s.date)} · tmax{' '}
      <B>{i.max_tmax_c}°C</B> · rain <B>{i.mean_rainfall_mm}mm</B> · heat{' '}
      <span style={{ color: i.heat_stress_fraction > 0 ? COLORS.danger : COLORS.ink }}>
        {(i.heat_stress_fraction * 100).toFixed(0)}%
      </span>{' '}
      · dryness <B>{i.dryness_index}</B>
    </Line>
  )
}

function ForecastResult({ f }: { f: ForecastResp }) {
  const rain = f.days.map((d) => d.impacts.mean_rainfall_mm)
  const tmax = f.days.map((d) => d.impacts.max_tmax_c)
  const sw = f.sowing_window
  return (
    <div className="text-ink/90">
      <div>
        <span className="text-muted">forecast</span> {prettyDate(f.init_date)} · {f.model} ·{' '}
        {f.horizon}d · sowing{' '}
        {sw.sowing_ok ? (
          <span style={{ color: COLORS.online }}>onset +{sw.onset_lead_day}d</span>
        ) : (
          <span className="text-muted">none</span>
        )}
      </div>
      <div className="mt-1 flex items-center gap-4">
        <SparkRow label="rain" values={rain} color={COLORS.isro} unit="mm" />
        <SparkRow label="tmax" values={tmax} color={COLORS.saffron} unit="°C" />
      </div>
    </div>
  )
}

function WhatIfResult({ r }: { r: WhatIfResp }) {
  const d = r.days[r.days.length - 1]
  const b = d.impacts_baseline
  const sc = d.impacts_scenario
  const p = r.scenario_params
  return (
    <div className="text-ink/90">
      <div>
        <span className="text-muted">whatif</span> {prettyDate(r.init_date)} · ΔT{' '}
        {p.delta_temp > 0 ? '+' : ''}
        {p.delta_temp}°C · rain ×{p.rain_factor} · +{d.lead_day}d
      </div>
      <div className="mt-0.5">
        tmax <B>{b.max_tmax_c}</B>→
        <span style={{ color: sc.max_tmax_c > b.max_tmax_c ? COLORS.danger : COLORS.online }}>
          {sc.max_tmax_c}°C
        </span>{' '}
        · heat {(b.heat_stress_fraction * 100).toFixed(0)}→
        <span style={{ color: sc.heat_stress_fraction > b.heat_stress_fraction ? COLORS.danger : COLORS.online }}>
          {(sc.heat_stress_fraction * 100).toFixed(0)}%
        </span>{' '}
        · sowing {r.sowing_baseline.onset_lead_day ?? '—'}→{r.sowing_scenario.onset_lead_day ?? 'none'}
      </div>
    </div>
  )
}

function ValidateResult({ v }: { v: ValidateResp }) {
  const h = Object.keys(v.summary_rmse)[0] // smallest horizon
  const vars = ['rainfall', 'tmax', 'tmin']
  return (
    <div className="text-ink/90">
      <div className="text-muted">
        validate · {h}d · RMSE (lower better) · best <span className="text-online">■</span>
      </div>
      <table className="mt-1 border-separate" style={{ borderSpacing: '10px 1px' }}>
        <thead>
          <tr className="text-muted/70">
            <th className="text-left font-normal">var</th>
            {v.models.map((m) => (
              <th key={m} className="text-right font-normal">
                {m}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {vars.map((vr) => {
            const row = v.summary_rmse[h]?.[vr] ?? {}
            const best = row.best as string
            return (
              <tr key={vr}>
                <td className="text-muted">{vr}</td>
                {v.models.map((m) => {
                  const val = row[`${m}_RMSE`] as number
                  const isBest = best === m
                  return (
                    <td
                      key={m}
                      className="text-right tabular-nums"
                      style={{ color: isBest ? COLORS.online : COLORS.ink }}
                    >
                      {typeof val === 'number' ? val.toFixed(2) : '—'}
                      {isBest ? ' ■' : ''}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function B({ children }: { children: ReactNode }) {
  return <span className="text-ink">{children}</span>
}

function SparkRow({
  label,
  values,
  color,
  unit,
}: {
  label: string
  values: number[]
  color: string
  unit: string
}) {
  const last = values[values.length - 1]
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-muted/70">{label}</span>
      <Sparkline values={values} color={color} />
      <span style={{ color }}>
        {last?.toFixed(1)}
        {unit}
      </span>
    </span>
  )
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 56
  const h = 16
  if (values.length < 2) return <svg width={w} height={h} />
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (w - 2) + 1
      const y = h - 2 - ((v - min) / span) * (h - 4)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.3} strokeLinejoin="round" />
    </svg>
  )
}
