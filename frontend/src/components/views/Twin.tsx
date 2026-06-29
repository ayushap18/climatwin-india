// Twin.tsx — the digital twin, working. Runs the real ClimateTwin loop (/twin/run) and
// shows REALITY ⟷ TWIN side by side with live drift: the twin is MIRRORed at an anchor
// date, SIMULATEs forward, and either free-runs (drifts) or ASSIMILATEs each observation
// (re-syncs). The Twin Core ring shows the live sync %; a chart plots drift over lead days.

import { useEffect, useMemo, useState } from 'react'
import TwinCore from '../twin/TwinCore'
import SyncFlow from '../twin/SyncFlow'
import { FieldHeatmap } from '../ui/field-heatmap'
import LayerSwitch from '../controls/LayerSwitch'
import ProvenanceFooter from '../shell/ProvenanceFooter'
import ImpactBadges from '../panels/ImpactBadges'
import { getTwinRun } from '../../api/endpoints'
import { twinBus, type TwinStage } from '../../api/client'
import { useTwinStream } from '../../state/useTwinStream'
import type { TwinRunResp, VarName } from '../../api/types'
import { colorForValue, colorForScale } from '../../lib/colormaps'
import { prettyDate } from '../../lib/format'
import { COLORS } from '../../theme'
import { useThemeColors } from '../../lib/useThemeColors'
import { useAppDispatch, useAppState } from '../../state/useAppState'
import { useActiveSource, useSnapDateToSource } from '../../lib/sources'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function absDiff(a: number[][], b: number[][]): { grid: number[][]; max: number } {
  let max = 0
  const grid = a.map((row, i) =>
    row.map((v, j) => {
      const d = Math.abs(v - (b[i]?.[j] ?? v))
      if (d > max) max = d
      return d
    }),
  )
  return { grid, max: Math.max(0.5, max) }
}
function syncColor(pct: number | null): string {
  if (pct == null) return COLORS.muted
  if (pct >= 66) return COLORS.online
  if (pct >= 33) return COLORS.saffron
  return COLORS.danger
}

interface StageDef {
  id: TwinStage
  math: string
  explain: string
}
const WALK: StageDef[] = [
  { id: 'MIRROR', math: 'state ← obs(anchor)', explain: 'Initialize the twin from the observed cube at the anchor date — twin = reality, sync ~100%.' },
  { id: 'ASSIMILATE', math: 'state = α·obs + (1−α)·state', explain: 'Nudge the twin toward each fresh observation so it tracks reality instead of drifting.' },
  { id: 'SIMULATE', math: 'x₍ₖ₊₁₎ = f(x₍ₖ₎)', explain: 'Roll the state forward autoregressively; with no new obs the twin drifts from reality.' },
  { id: 'PERTURB', math: 'Tmax += ΔT · rain ×= f', explain: 'Apply a counterfactual forcing and re-simulate — that’s the What-If view.' },
  { id: 'IMPACT', math: 'Tmax > 40°C → heat', explain: 'Turn the twin’s fields into decision signals: heat-stress, dryness, sowing.' },
]

export default function Twin() {
  const { meta, activeVariable, gridContrast } = useAppState()
  const { source: src } = useActiveSource()
  const dispatch = useAppDispatch()
  const c = useThemeColors()
  const [stage, setStage] = useState<TwinStage | null>(null)

  // models/colorbar are per-regime: insat_real has its own forecasters + a different grid
  // range, so reading meta.models (the synthetic list) would offer models the backend
  // rejects in this regime. Fall back to the global lists for an older backend.
  const sourceMeta = useMemo(() => meta?.sources?.find((s) => s.key === src?.key) ?? null, [meta, src])
  const models = sourceMeta?.models ?? meta?.models ?? []
  const preferredModel = models.includes('convlstm')
    ? 'convlstm'
    : models.includes('persistence')
      ? 'persistence'
      : (meta?.default_model ?? '')

  const [model, setModel] = useState('')
  const [assimilate, setAssimilate] = useState(false)
  const [horizon, setHorizon] = useState(7)
  const [anchor, setAnchor] = useState('')
  useSnapDateToSource(anchor, setAnchor)
  const [lead, setLead] = useState(1)
  const [restRun, setRestRun] = useState<TwinRunResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [live, setLive] = useState(false)

  // simulated real-time: stream the twin loop over a WebSocket (offline-safe replay)
  const stream = useTwinStream(
    { date: anchor, horizon, assimilate, model, intervalMs: 700 },
    live && !!anchor && !!model,
  )
  const run = live && stream.run ? stream.run : restRun

  // initialize model + anchor once meta is ready, and re-pick the model whenever the regime
  // changes (the current pick may not exist in the new regime's forecaster set).
  useEffect(() => {
    if (!meta) return
    if (!model || !models.includes(model)) setModel(preferredModel)
    if (!anchor) setAnchor(addDaysISO(meta.latest_date, -horizon))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, src?.key])

  useEffect(() => {
    if (!anchor || !model || live) return // live mode is fed by the WebSocket, not REST
    let on = true
    setLoading(true)
    getTwinRun({ date: anchor, horizon, assimilate, model })
      .then((r) => on && setRestRun(r))
      .catch(() => {})
      .finally(() => on && setLoading(false))
    return () => {
      on = false
    }
  }, [anchor, horizon, assimilate, model, live])

  useEffect(() => {
    setLead((l) => Math.min(Math.max(1, l), horizon))
  }, [horizon])

  // while streaming, follow the most-recent day that has arrived
  useEffect(() => {
    if (live && stream.latestLead > 0) setLead(stream.latestLead)
  }, [live, stream.latestLead])

  function runStage(s: TwinStage) {
    setStage(s)
    twinBus.emit(s) // flare the matching node on the ring
    if (s === 'MIRROR') setLead(1)
    else if (s === 'SIMULATE') setLead(horizon)
    else if (s === 'ASSIMILATE') setAssimilate(true)
    else if (s === 'PERTURB') dispatch({ type: 'SET_VIEW', view: 'whatif' })
  }

  const day = run?.days[Math.min(lead, run.days.length) - 1] ?? null
  const range = (sourceMeta?.colorbar_ranges?.[activeVariable] ??
    meta?.colorbar_ranges?.[activeVariable] ??
    [0, 1]) as [number, number]
  const unit = run?.units[activeVariable] ?? ''

  const realityF = day?.reality?.[activeVariable] ?? null
  const twinF = day?.twin?.[activeVariable] ?? null
  const drift = useMemo(
    () => (realityF && twinF ? absDiff(twinF, realityF) : null),
    [realityF, twinF],
  )

  const chartData = (run?.days ?? []).map((d) => ({ lead: `+${d.lead_day}`, sync: d.sync_pct }))
  const colorFn = (v: number) => colorForValue(activeVariable, v, range, gridContrast)
  // color drift on an absolute scale (~40% of the variable's data span) so a small,
  // spatially-uniform drift doesn't saturate the diverging colormap to all-red.
  const driftRef = Math.max(1, (range[1] - range[0]) * 0.4)

  return (
    <div className="grid h-full grid-cols-1 gap-3 p-3 lg:grid-cols-[1fr_360px]">
      {/* ---- MAIN ---- */}
      <section className="relative flex min-h-[560px] flex-col overflow-hidden rounded-xl border border-line bg-panel/40">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="font-mono text-[11px] tracking-[0.22em] text-ink">
            DIGITAL TWIN · {assimilate ? 'ASSIMILATING' : 'FREE-RUN'} · {model || '—'}
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] text-muted">
              anchor {run ? prettyDate(run.anchor_date) : '…'} · {day ? `+${day.lead_day}d` : ''}
            </span>
            <button
              onClick={() => setLive((v) => !v)}
              title="replay the cached record as a live feed (offline-safe)"
              className={`flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] tracking-[0.12em] transition-colors ${
                live
                  ? 'border-danger/60 bg-danger/10 text-danger'
                  : 'border-line text-muted hover:border-isro/40 hover:text-ink'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  live ? 'bg-danger ' + (stream.streaming ? 'ct-blink' : '') : 'bg-muted'
                }`}
              />
              {live ? (stream.streaming ? 'LIVE' : stream.done ? 'REPLAYED' : 'LIVE') : 'GO LIVE'}
            </button>
          </div>
        </div>

        {/* stage walkthrough — click a stage to run it and read the math */}
        <div className="border-b border-line px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {WALK.map((w, i) => {
              const active = stage === w.id
              return (
                <button
                  key={w.id}
                  onClick={() => runStage(w.id)}
                  className={`flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] tracking-[0.08em] transition-colors ${
                    active
                      ? 'border-saffron/60 bg-saffron/10 text-saffron'
                      : 'border-line text-muted hover:border-isro/40 hover:text-ink'
                  }`}
                >
                  <span className="opacity-60">{i + 1}</span>
                  {w.id}
                  {i < WALK.length - 1 && <span className="ml-1 text-muted/40">→</span>}
                </button>
              )
            })}
          </div>
          {stage && (
            <div className="mt-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
              <code className="shrink-0 rounded border border-line bg-bg/60 px-2 py-1 font-mono text-[10px] text-online">
                {WALK.find((w) => w.id === stage)?.math}
              </code>
              <span className="text-[11px] leading-snug text-muted">
                {WALK.find((w) => w.id === stage)?.explain}
              </span>
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col items-center justify-center gap-5 p-5">
          {/* horizontal sync path */}
          <div className="w-full max-w-3xl">
            <SyncFlow syncPct={day?.sync_pct ?? null} assimilating={assimilate} />
          </div>
          {/* ring with live sync */}
          <TwinCore
            size={180}
            showLabels={false}
            centerValue={day?.sync_pct != null ? `${day.sync_pct.toFixed(0)}%` : '—'}
            centerSub="SYNC"
            centerColor={syncColor(day?.sync_pct ?? null)}
          />

          {/* reality | twin | drift */}
          {realityF && twinF && drift ? (
            <div className="flex flex-wrap items-start justify-center gap-4">
              <FieldHeatmap
                field={realityF}
                color={colorFn}
                title="REALITY"
                sub={`observed · ${activeVariable}`}
                width={184}
                highlight={COLORS.isro}
              />
              <FieldHeatmap
                field={twinF}
                color={colorFn}
                title="TWIN"
                sub={`simulated · ${day?.sync_pct?.toFixed(0)}% sync`}
                width={184}
                highlight={syncColor(day?.sync_pct ?? null)}
              />
              <FieldHeatmap
                field={drift.grid}
                color={(v) => colorForScale(v, [0, driftRef], 'error', gridContrast)}
                title="DRIFT"
                sub={`Δ${activeVariable} · max ${drift.max.toFixed(1)}${unit}`}
                width={184}
              />
            </div>
          ) : (
            <div className="font-mono text-xs text-muted">{loading ? 'running twin…' : 'no data'}</div>
          )}

          {/* lead-day scrub */}
          <div className="flex w-full max-w-xl items-center gap-3">
            <span className="font-mono text-[10px] tracking-[0.12em] text-muted">LEAD</span>
            <input
              type="range"
              min={1}
              max={horizon}
              value={lead}
              onChange={(e) => setLead(Number(e.target.value))}
              className="ct-range flex-1"
            />
            <span className="w-16 text-right font-mono text-[11px] text-saffron tabular-nums">
              +{lead}d / {horizon}d
            </span>
          </div>
        </div>
      </section>

      {/* ---- RIGHT COLUMN ---- */}
      <aside className="flex min-h-0 flex-col gap-3">
        <div className="rounded-xl border border-line bg-panel/40 p-3">
          <PanelTitle>TWIN CONTROLS</PanelTitle>
          {src && (
            <div className="mt-2 flex items-center justify-between rounded-md border border-line bg-panel-2/50 px-2 py-1 font-mono text-[9px]">
              <span className="tracking-[0.1em] text-saffron/80">{src.lstLabel}</span>
              <span className="text-muted">
                {src.dateStart.slice(0, 4)}–{src.dateEnd.slice(0, 4)}
              </span>
            </div>
          )}
          <div className="mt-2 space-y-2.5">
            {/* the ASSIMILATE switch — the heart of the twin */}
            <button
              onClick={() => setAssimilate((a) => !a)}
              className={`flex w-full items-center justify-between rounded-md border px-3 py-2 font-mono text-[11px] tracking-[0.1em] transition-colors ${
                assimilate
                  ? 'border-online/60 bg-online/10 text-online'
                  : 'border-line text-muted hover:border-isro/40 hover:text-ink'
              }`}
            >
              <span>ASSIMILATE OBSERVATIONS</span>
              <span
                className={`grid h-4 w-8 place-items-center rounded-full text-[8px] ${
                  assimilate ? 'bg-online/30' : 'bg-line'
                }`}
              >
                {assimilate ? 'ON' : 'OFF'}
              </span>
            </button>
            <div className="font-mono text-[9px] leading-snug text-muted">
              {assimilate
                ? 'twin is nudged toward each day’s observation → it tracks reality.'
                : 'twin runs blind from the anchor → watch it drift from reality.'}
            </div>
            <Row label="MODEL">
              <ModelSelectInline value={model} onChange={setModel} options={models} />
            </Row>
            <Row label="LAYER">
              <LayerSwitch />
            </Row>
            <Row label="ANCHOR">
              <input
                type="date"
                value={anchor}
                min={src?.dateStart ?? meta?.dates.start}
                max={src?.dateEnd ?? meta?.dates.end}
                onChange={(e) => setAnchor(e.target.value)}
                className="rounded border border-line bg-panel-2 px-2 py-1 font-mono text-[11px] text-ink [color-scheme:dark]"
              />
            </Row>
            <Row label="HORIZON">
              <div className="flex items-center gap-2">
                <Step label="−" onClick={() => setHorizon((h) => Math.max(1, h - 1))} />
                <span className="w-10 text-center font-mono text-xs text-ink tabular-nums">
                  {horizon}d
                </span>
                <Step
                  label="+"
                  onClick={() => setHorizon((h) => Math.min(meta?.max_horizon ?? 14, h + 1))}
                />
              </div>
            </Row>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-xl border border-line bg-panel/40 p-3">
          <PanelTitle>DRIFT · SYNC OVER LEAD</PanelTitle>
          {src && src.key !== 'synthetic' && (
            <div className="rounded-md border border-saffron/30 bg-saffron/5 px-2.5 py-2 font-mono text-[9px] leading-relaxed text-saffron/90">
              Real INSAT-3D LST regime, single-year model: the twin tracks reality well at +1 day
              but drifts faster by +7 days than the multi-year synthetic regime. Turn ASSIMILATE on
              to nudge it back toward each observation.
            </div>
          )}
          <div className="h-[120px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 6, right: 6, bottom: 0, left: -22 }}>
                <CartesianGrid stroke={c.line} strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="lead" tick={{ fill: c.muted, fontSize: 9 }} stroke={c.line} />
                <YAxis domain={[0, 100]} tick={{ fill: c.muted, fontSize: 9 }} stroke={c.line} width={30} />
                <Tooltip
                  contentStyle={{ background: c.panel, border: `1px solid ${c.line}`, fontSize: 11 }}
                  formatter={(v: number) => [`${v}%`, 'sync']}
                />
                <ReferenceLine x={`+${lead}`} stroke={COLORS.saffron} strokeDasharray="3 3" />
                <Line
                  type="monotone"
                  dataKey="sync"
                  stroke={assimilate ? COLORS.online : COLORS.danger}
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          {day?.divergence && (
            <div className="grid grid-cols-3 gap-1.5 font-mono text-[10px]">
              {(['rainfall', 'tmax', 'tmin'] as VarName[]).map((v) => (
                <div key={v} className="rounded-md border border-line bg-panel-2/60 px-2 py-1.5 text-center">
                  <div className="text-[8px] uppercase tracking-[0.12em] text-muted">Δ{v}</div>
                  <div className="text-ink">{day.divergence?.[v]}</div>
                </div>
              ))}
            </div>
          )}
          <div>
            <div className="mb-1 font-mono text-[9px] uppercase tracking-[0.15em] text-muted">
              twin impacts · +{lead}d
            </div>
            <ImpactBadges impacts={day?.impacts_twin ?? null} />
          </div>
        </div>

        <div className="rounded-xl border border-line bg-panel/40">
          <ProvenanceFooter />
        </div>
      </aside>
    </div>
  )
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">{children}</div>
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="font-mono text-[10px] tracking-[0.12em] text-muted">{label}</span>
      {children}
    </div>
  )
}
function Step({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="grid h-6 w-6 place-items-center rounded border border-line font-mono text-xs text-muted transition-colors hover:border-isro/50 hover:text-ink"
    >
      {label}
    </button>
  )
}
function ModelSelectInline({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
}) {
  return (
    <div className="flex gap-1">
      {options.map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`rounded-md border px-2 py-1 font-mono text-[9px] tracking-[0.06em] transition-colors ${
            value === m
              ? 'border-isro/60 bg-isro/10 text-ink'
              : 'border-line text-muted hover:border-isro/40 hover:text-ink'
          }`}
        >
          {m}
        </button>
      ))}
    </div>
  )
}
