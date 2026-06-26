// CommandConsole.tsx — a docked, collapsible REPL (no xterm). Parses a small command set,
// calls the typed API, and renders COMPACT inline results (tables / sparklines / key-values,
// never raw JSON). Every command also flares the twin loop (ASSIMILATE — the console feeding
// the twin — plus whatever stage the underlying endpoint emits).

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ApiError, twinBus } from '../../api/client'
import {
  getAi,
  getDownscale,
  getForecast,
  getState,
  getValidate,
  postWhatIf,
} from '../../api/endpoints'
import type { AiResp, ForecastResp, StateResp, ValidateResp, WhatIfResp } from '../../api/types'
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
  const histIdx = useRef<number>(-1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!collapsed) inputRef.current?.focus()
  }, [collapsed])
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [entries, collapsed])

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
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] tracking-[0.15em] text-muted hover:text-ink"
      >
        <span className="text-saffron">{collapsed ? '▸' : '▾'}</span>
        <span>TWIN CONSOLE</span>
        {collapsed && (
          <span className="text-muted/60">
            — type <span className="text-ink">help</span>
            <span className="ct-blink text-saffron"> ▋</span>
          </span>
        )}
        <span className="ml-auto text-[9px] text-muted/50">
          {collapsed ? 'click to open' : 'ai · forecast · whatif · state · validate · downscale'}
        </span>
      </button>

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
              placeholder="ai is it a good time to sow?"
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

  switch (name as (typeof COMMANDS)[number]) {
    case 'ai': {
      const question = args.join(' ').trim()
      if (!question)
        return <span className="text-muted">usage: ai &lt;question&gt; — e.g. ai is it a good time to sow?</span>
      const r = await getAi(question)
      return <AiResult r={r} />
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
function AiResult({ r }: { r: AiResp }) {
  return (
    <div className="text-ink/90">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 rounded bg-saffron/15 px-1.5 py-0.5 text-[9px] tracking-[0.1em] text-saffron">
          AI
        </span>
        <span className="leading-relaxed">{r.answer}</span>
      </div>
      <div className="mt-1 pl-8 font-mono text-[9px] text-muted/60">
        {r.intent} · {r.provider}
        {r.used.length ? ` · called ${r.used.join(', ')}` : ''}
      </div>
    </div>
  )
}

function Banner() {
  return (
    <div className="text-muted">
      <span className="text-ink">ClimaTwin console.</span> ask the assistant or run a command:
      <div className="mt-1 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
        <Cmd k="ai <question>" d="grounded assistant (e.g. ai when to sow?)" />
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
