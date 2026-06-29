// Downscale.tsx — SR-CNN super-resolution. Coarsen the true field to ~1°, then compare
// bilinear vs the SR-CNN reconstruction at 0.25° with an interactive reveal slider and the
// % improvement. Hidden from the nav when no checkpoint exists; renders a designed
// explainer (pipeline + math) if reached anyway. Built so it lights up on a full backend.

import { useEffect, useMemo, useRef, useState } from 'react'
import ProvenanceFooter from '../shell/ProvenanceFooter'
import SmoothField from '../map/SmoothField'
import InfoPopover from '../panels/InfoPopover'
import { getDiffusion, getDownscale, getHighres } from '../../api/endpoints'
import type { DiffusionMetrics, DiffusionResp, DownscaleResp, HighresResp, VarName } from '../../api/types'
import { colorForScale, colorForValue } from '../../lib/colormaps'
import { gradientEnergy, histogram, radialSpectrum } from '../../lib/fieldstats'
import { useActiveSource } from '../../lib/sources'
import { useThemeColors } from '../../lib/useThemeColors'
import { useAppState } from '../../state/useAppState'
import { COLORS } from '../../theme'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'

const VARS: VarName[] = ['rainfall', 'tmax', 'tmin']
// A wet monsoon day so the super-resolution / diffusion panels show real rainfall structure
// (the latest cube date is a dry winter day where every method looks blank).
const DEMO_DATE = '2023-08-23'

function dataRange(grid: number[][]): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const row of grid)
    for (const x of row) {
      if (x < lo) lo = x
      if (x > hi) hi = x
    }
  return [lo, hi === lo ? lo + 1 : hi]
}

export default function Downscale() {
  const { meta, gridContrast } = useAppState()
  const { source: src, clamp } = useActiveSource()
  const [varName, setVarName] = useState<VarName>('rainfall')
  const [dsDate, setDsDate] = useState<string>(DEMO_DATE) // editable; defaults to a wet day
  const [ds, setDs] = useState<DownscaleResp | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Keep the requested day inside the ACTIVE regime window — not just the synthetic cube range.
  // The insat_real regime is 2020-only, so the curated 2023 wet day (valid for synthetic) is out
  // of range there and would 404; on a regime change we snap to that regime's curated featured day
  // (e.g. a 2020 monsoon day), falling back to clamping into [dateStart, dateEnd]. Synthetic keeps
  // the 2023 wet day because it stays in range — synthetic behaviour is unchanged.
  useEffect(() => {
    if (!src) return
    if (dsDate < src.dateStart || dsDate > src.dateEnd) {
      const f = src.featured
      setDsDate(f >= src.dateStart && f <= src.dateEnd ? f : (clamp(dsDate) as string))
    }
    // re-clamp only on regime change (src.key), not on every date keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src?.key])

  useEffect(() => {
    let on = true
    setError(null)
    setDs(null)
    getDownscale(dsDate, varName)
      .then((r) => on && setDs(r))
      .catch((e) => on && setError(e.message))
    return () => {
      on = false
    }
    // src?.key so a regime switch refetches even when the date is valid in both regimes.
  }, [varName, dsDate, src?.key])

  // real 0.05° INDmet field for the same day (genuine high-res, rainfall only)
  const [hr, setHr] = useState<HighresResp | null>(null)
  useEffect(() => {
    if (!ds || varName !== 'rainfall' || !meta?.highres_available) {
      setHr(null)
      return
    }
    let on = true
    getHighres(ds.date, 'rainfall')
      .then((r) => on && setHr(r))
      .catch(() => on && setHr(null))
    return () => {
      on = false
    }
  }, [ds, varName, meta?.highres_available])

  const range = useMemo<[number, number]>(
    () => (ds ? dataRange(ds.srcnn) : (meta?.colorbar_ranges[varName] ?? [0, 1])),
    [ds, meta, varName],
  )

  // client-side field analytics (deterministic functions of returned fields)
  const stats = useMemo(() => {
    if (!ds) return null
    const eb = gradientEnergy(ds.bilinear)
    const es = gradientEnergy(ds.srcnn)
    const eh = hr ? gradientEnergy(hr.field) : null
    const hmax = Math.max(range[1], 1)
    return {
      texture: { bilinear: eb, srcnn: es, truth: eh },
      hist: {
        bilinear: histogram(ds.bilinear, 8, hmax),
        srcnn: histogram(ds.srcnn, 8, hmax),
      },
      spectrum: { bilinear: radialSpectrum(ds.bilinear), srcnn: radialSpectrum(ds.srcnn) },
    }
  }, [ds, hr, range])

  return (
    <div className="grid h-full grid-cols-1 gap-3 p-3 lg:grid-cols-[1fr_340px]">
      {/* ---- MAIN ---- */}
      <section className="relative flex min-h-[480px] flex-col overflow-hidden rounded-xl border border-line bg-panel/40">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.22em] text-ink">
            SUPER-RESOLUTION · {varName.toUpperCase()}
            <InfoPopover>
              Drag the divider to wipe between the bilinear upsample and the SR-CNN
              reconstruction of the same coarse field. Both target the true 0.25° grid.
            </InfoPopover>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9px] tracking-[0.12em] text-muted/70">DATE</span>
            <input
              type="date"
              value={dsDate}
              min={src?.dateStart ?? meta?.dates.start}
              max={src?.dateEnd ?? meta?.dates.end}
              onChange={(e) => e.target.value && setDsDate(e.target.value)}
              className="rounded border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-ink [color-scheme:dark]"
            />
          </div>
        </div>

        {/* pipeline strip — always shown */}
        <div className="flex items-center justify-center gap-2 border-b border-line px-4 py-2 font-mono text-[9px] text-muted">
          <Pill>COARSE ~1°</Pill>→<Pill>BILINEAR</Pill>
          <span className="text-muted/50">vs</span>
          <Pill accent>SR-CNN</Pill>→
          <span className="text-online">imp% = 100·(RMSEᵦ − RMSEₛ)/RMSEᵦ</span>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-5">
          {ds ? (
            <>
              <div className="flex flex-wrap items-center justify-center gap-6">
                <Thumb title="COARSE INPUT ~1°" field={ds.coarse} varName={varName} range={range} contrast={gridContrast} />
                <Reveal
                  a={ds.bilinear}
                  b={ds.srcnn}
                  varName={varName}
                  range={range}
                  contrast={gridContrast}
                  aLabel={`BILINEAR · RMSE ${ds.bilinear_rmse?.toFixed(2) ?? '—'}`}
                  bLabel={`SR-CNN · RMSE ${ds.srcnn_rmse?.toFixed(2) ?? '—'}`}
                />
              </div>
              <ResolutionLadder ds={ds} hr={hr} varName={varName} range={range} contrast={gridContrast} />
              {(meta?.diffusion_vars ?? []).includes(varName) && (
                <DiffusionEnsemble date={ds.date} varName={varName} contrast={gridContrast} />
              )}
            </>
          ) : error ? (
            <div className="m-auto">
              <UnavailableExplainer error={error} available={meta?.downscale_available !== false} />
            </div>
          ) : (
            <div className="m-auto font-mono text-xs text-muted">loading…</div>
          )}
        </div>
      </section>

      {/* ---- RIGHT COLUMN ---- */}
      <aside className="flex min-h-0 flex-col gap-3">
        <div className="rounded-xl border border-line bg-panel/40 p-3">
          <PanelTitle>VARIABLE</PanelTitle>
          <div className="mt-2 flex gap-1">
            {VARS.map((vr) => (
              <button
                key={vr}
                onClick={() => setVarName(vr)}
                className={`flex-1 rounded-md border px-2 py-1.5 font-mono text-[10px] tracking-[0.1em] transition-colors ${
                  varName === vr
                    ? 'border-saffron/60 bg-saffron/10 text-saffron'
                    : 'border-line text-muted hover:border-isro/40 hover:text-ink'
                }`}
              >
                {vr.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-xl border border-line bg-panel/40 p-3">
          <PanelTitle>RECONSTRUCTION SKILL</PanelTitle>
          {ds ? (
            <div className="space-y-2 font-mono text-[11px]">
              <Stat label="bilinear RMSE" value={ds.bilinear_rmse?.toFixed(3) ?? '—'} />
              <Stat label="SR-CNN RMSE" value={ds.srcnn_rmse?.toFixed(3) ?? '—'} accent={COLORS.online} />
              <div className="rounded-md border border-online/30 bg-online/5 px-3 py-2 text-center">
                <div className="text-[9px] uppercase tracking-[0.15em] text-muted">improvement</div>
                <div className="text-xl text-online">
                  {ds.improvement_pct != null ? `${ds.improvement_pct}%` : '—'}
                </div>
                <div className="text-[9px] text-muted">SR-CNN vs bilinear (RMSE)</div>
              </div>

              {ds.dem_ablation && varName === ds.dem_ablation.var && (
                <div className="rounded-md border border-saffron/30 bg-saffron/5 p-2.5">
                  <div className="mb-1.5 text-[9px] uppercase tracking-[0.15em] text-saffron">
                    ⛰ DEM ablation — does the elevation help?
                  </div>
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-ink">with DEM</span>
                    <span className="text-saffron">
                      {ds.dem_ablation.improvement_with_dem_pct}%
                      <span className="text-muted/60"> · RMSE {ds.dem_ablation.srcnn_with_dem_rmse.toFixed(2)}</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-muted">without DEM</span>
                    <span className="text-muted">
                      {ds.dem_ablation.improvement_no_dem_pct}%
                      <span className="text-muted/60"> · RMSE {ds.dem_ablation.srcnn_no_dem_rmse.toFixed(2)}</span>
                    </span>
                  </div>
                  <div className="mt-1.5 text-center text-[10px] text-ink">
                    the real DEM cuts SR error by <span className="text-saffron">{ds.dem_ablation.dem_gain_pct}%</span>
                  </div>
                  <div className="mt-0.5 text-center text-[8px] leading-snug text-muted/70">
                    identical SR-CNNs ± the OpenTopography elevation channel · test split · modest at 0.25°, grows with region
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="font-mono text-[10px] text-muted">{error ?? 'loading…'}</div>
          )}

          {stats && (
            <>
              <TextureBars t={stats.texture} hasTruth={!!hr} />
              <SpectrumChart s={stats.spectrum} />
              <HistogramChart h={stats.hist} hmax={Math.max(range[1], 1)} />
            </>
          )}
          <div className="rounded-md border border-line bg-bg/50 px-2.5 py-2 font-mono text-[9px] leading-relaxed text-muted/80">
            <div className="mb-1 text-isro">how it works</div>
            1 · coarsen the true 0.25° field to ~1° (block-mean).<br />
            2 · upsample back two ways — bilinear vs a trained SR-CNN.<br />
            3 · score each against the truth; lower RMSE wins.
          </div>
          {ds?.source_note && (
            <div className="rounded-md border border-isro/20 bg-isro/5 px-2.5 py-2 font-mono text-[9px] leading-relaxed text-muted/90">
              {ds.source_note}
            </div>
          )}
          {meta?.highres_available && (
            <div className="rounded-md border border-saffron/30 bg-saffron/5 px-2.5 py-2 font-mono text-[9px] leading-relaxed text-muted/90">
              <div className="mb-1 text-saffron">validated vs real 5 km truth (INDmet 0.05°)</div>
              A deterministic 0.25°→0.05° SR-CNN, scored against genuine high-res data, recovers{' '}
              <span className="text-online">~1.7× more fine-scale texture</span> than bilinear (41% vs
              24% of the real structure) but <span className="text-danger">loses ~7% on RMSE</span> —
              the classic “double-penalty”: sharp detail placed slightly wrong is punished twice. This
              is exactly why SOTA downscaling (NVIDIA CorrDiff) uses <span className="text-isro">generative
              diffusion</span> and spatial/spectral skill (FSS, power-spectra, CRPS), not RMSE.
            </div>
          )}
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
function Pill({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span
      className={`rounded border px-1.5 py-0.5 ${
        accent ? 'border-online/40 text-online' : 'border-line text-ink/80'
      }`}
    >
      {children}
    </span>
  )
}
function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-line bg-panel-2/60 px-2.5 py-1.5">
      <span className="text-[10px] text-muted">{label}</span>
      <span className="tabular-nums" style={{ color: accent ?? COLORS.ink }}>
        {value}
      </span>
    </div>
  )
}

function UnavailableExplainer({ error, available }: { error: string; available: boolean }) {
  return (
    <div className="max-w-lg text-center">
      <div className="mb-4 flex items-center justify-center gap-2">
        <PlaceholderTile label="COARSE ~1°" />
        <span className="text-muted/50">→</span>
        <PlaceholderTile label="BILINEAR" />
        <span className="text-muted/50">vs</span>
        <PlaceholderTile label="SR-CNN" accent />
      </div>
      {available ? (
        // The downscaler IS trained — this is a transient fetch / out-of-range day, not a missing
        // model. The date is clamped to the active regime, so this should be rare; surface the
        // real error and tell the user to pick an in-window day rather than implying no SR-CNN.
        <>
          <div className="font-mono text-xs text-danger">no downscale for this day</div>
          <div className="mt-2 font-mono text-[11px] leading-relaxed text-muted">{error}</div>
          <div className="mt-3 font-mono text-[11px] text-muted/80">
            Pick a date inside the active data regime’s window — the SR-CNN reconstruction lights up
            for every covered day.
          </div>
        </>
      ) : (
        <>
          <div className="font-mono text-xs text-danger">downscaler unavailable in this deployment</div>
          <div className="mt-2 font-mono text-[11px] leading-relaxed text-muted">{error}</div>
          <div className="mt-3 font-mono text-[11px] text-muted/80">
            Train the SR-CNN with <span className="text-ink">make downscale</span> and this view lights
            up: drag-to-compare the two reconstructions with the live % improvement.
          </div>
        </>
      )}
    </div>
  )
}
function PlaceholderTile({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div
        className="h-16 w-20 rounded-md border"
        style={{
          borderColor: accent ? 'rgba(54,211,153,0.4)' : COLORS.line,
          background:
            'repeating-linear-gradient(45deg, rgba(120,140,180,0.06) 0 6px, transparent 6px 12px)',
        }}
      />
      <span className="font-mono text-[9px] text-muted">{label}</span>
    </div>
  )
}

// drag-to-reveal comparison of two fields rendered as colored grids
function Reveal({
  a,
  b,
  varName,
  range,
  contrast,
  aLabel,
  bLabel,
}: {
  a: number[][]
  b: number[][]
  varName: VarName
  range: [number, number]
  contrast: number
  aLabel: string
  bLabel: string
}) {
  const [pos, setPos] = useState(50)
  const w = 300
  const rows = b.length
  const cols = b[0]?.length ?? 1
  const h = (w / cols) * rows
  const boxRef = useRef<HTMLDivElement>(null)
  const drag = (clientX: number) => {
    const r = boxRef.current?.getBoundingClientRect()
    if (!r) return
    setPos(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)))
  }
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        ref={boxRef}
        className="relative cursor-ew-resize select-none overflow-hidden rounded-md"
        style={{ width: w, height: h, outline: `1px solid ${COLORS.line}` }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag(e.clientX)
        }}
        onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && drag(e.clientX)}
      >
        <Grid field={a} varName={varName} range={range} contrast={contrast} w={w} />
        <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
          <Grid field={b} varName={varName} range={range} contrast={contrast} w={w} />
        </div>
        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 bg-saffron"
          style={{ left: `${pos}%`, boxShadow: '0 0 8px #ff8a3d' }}
        />
        <span className="absolute left-1 top-1 rounded bg-bg/70 px-1 font-mono text-[8px] text-isro">
          {aLabel}
        </span>
        <span className="absolute right-1 top-1 rounded bg-bg/70 px-1 font-mono text-[8px] text-online">
          {bLabel}
        </span>
      </div>
      <div className="font-mono text-[9px] text-muted">◄ drag to wipe ►</div>
    </div>
  )
}

function Grid({
  field,
  varName,
  range,
  contrast,
  w,
  colorFn,
}: {
  field: number[][]
  varName: VarName
  range: [number, number]
  contrast: number
  w: number
  colorFn?: (val: number) => string
}) {
  const rows = field.length
  const cols = field[0]?.length ?? 1
  const cell = w / cols
  const h = cell * rows
  // tighter gaps on fine grids so a 40×60 field still reads as a continuous field
  const gap = cols > 20 ? 0.4 : 1.5
  const fill = colorFn ?? ((val: number) => colorForValue(varName, val, range, contrast))
  return (
    <svg width={w} height={h} className="block">
      {field.map((row, i) =>
        row.map((val, j) => (
          <rect
            key={`${i}-${j}`}
            x={j * cell + gap / 2}
            y={(rows - 1 - i) * cell + gap / 2}
            width={cell - gap}
            height={cell - gap}
            rx={cols > 20 ? 0 : 2}
            fill={fill(val)}
          />
        )),
      )}
    </svg>
  )
}

function Thumb({
  title,
  field,
  varName,
  range,
  contrast = 1,
}: {
  title: string
  field: number[][]
  varName: VarName
  range: [number, number]
  contrast?: number
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="rounded-md" style={{ outline: `1px solid ${COLORS.line}` }}>
        <Grid field={field} varName={varName} range={range} contrast={contrast} w={150} />
      </div>
      <div className="font-mono text-[10px] tracking-[0.12em] text-ink">{title}</div>
    </div>
  )
}

// --------------------------------------------------------------------------- //
// RESOLUTION LADDER — coarse 1° → 0.25° model → real 0.05° INDmet
// --------------------------------------------------------------------------- //
function ResolutionLadder({
  ds, hr, varName, range, contrast,
}: {
  ds: DownscaleResp; hr: HighresResp | null; varName: VarName; range: [number, number]; contrast: number
}) {
  const steps: Array<{
    field: number[][]; label: string; res: string; cells: string; km: string; accent?: boolean; real?: boolean
  }> = [
    { field: ds.coarse, label: 'COARSE', res: '~1°', cells: `${ds.coarse.length}×${ds.coarse[0].length}`, km: '~110 km' },
    { field: ds.srcnn, label: 'SR-CNN', res: '0.25°', cells: `${ds.srcnn.length}×${ds.srcnn[0].length}`, km: '~28 km', accent: true },
  ]
  if (hr && varName === 'rainfall') {
    steps.push({ field: hr.field, label: 'INDmet', res: '0.05°', cells: `${hr.shape[0]}×${hr.shape[1]}`, km: '~5.5 km', real: true })
  }
  return (
    <div className="rounded-lg border border-line bg-bg/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="font-mono text-[10px] tracking-[0.15em] text-muted">RESOLUTION LADDER</span>
        <span className="font-mono text-[8px] text-muted/60">coarse → model → real 5 km</span>
      </div>
      <div className="flex flex-wrap items-end justify-center gap-2">
        {steps.map((s, i) => (
          <div key={s.label} className="flex items-end gap-2">
            <div className="flex flex-col items-center gap-1">
              <div
                className="rounded-md"
                style={{ outline: `1px solid ${s.real ? 'rgba(54,211,153,0.5)' : s.accent ? 'rgba(255,138,61,0.5)' : COLORS.line}` }}
              >
                <Grid field={s.field} varName={varName} range={range} contrast={contrast} w={s.real ? 156 : 112} />
              </div>
              <div
                className="font-mono text-[9px] tracking-[0.1em]"
                style={{ color: s.real ? COLORS.online : s.accent ? COLORS.saffron : COLORS.ink }}
              >
                {s.label} · {s.res}
              </div>
              <div className="font-mono text-[8px] text-muted/70">{s.cells} · {s.km}/cell</div>
            </div>
            {i < steps.length - 1 && <span className="pb-6 text-lg text-muted/40">→</span>}
          </div>
        ))}
      </div>
      {!hr && varName === 'rainfall' && (
        <div className="mt-1.5 text-center font-mono text-[8px] text-muted/50">
          real 0.05° INDmet layer loads for observed rainfall days
        </div>
      )}
    </div>
  )
}

// --------------------------------------------------------------------------- //
// DIFFUSION ENSEMBLE — CorrDiff-style generative downscaling (the SOTA win)
// --------------------------------------------------------------------------- //
function DiffusionEnsemble({
  date, varName, contrast,
}: {
  date: string; varName: VarName; contrast: number
}) {
  const [d, setD] = useState<DiffusionResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => setD(null), [varName, date]) // reset when the variable/date changes
  const run = () => {
    setLoading(true)
    setErr(null)
    getDiffusion(date, 8, varName)
      .then(setD)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false))
  }
  const range: [number, number] = d ? d.range : [0, 30]
  const stdMax = useMemo(() => {
    if (!d) return 1
    let m = 0
    for (const row of d.std) for (const x of row) if (x > m) m = x
    return Math.max(m, 0.5)
  }, [d])

  // up to 2 raw stochastic members from /downscale/diffusion (additive backend field — read
  // defensively so this view renders them when present and stays correct if absent).
  const sampleGrids =
    (d as (DiffusionResp & { sample_grids?: number[][][] }) | null)?.sample_grids ?? []

  // headline pixel-RMSE improvement vs the bilinear baseline. Positive for smooth temp fields;
  // honestly negative for rainfall (sharp detail placed slightly wrong is double-penalised) —
  // there diffusion wins on CRPS/FSS instead, which we say rather than hide.
  const pctRMSE = d?.metrics
    ? Math.round((100 * (d.metrics.bilinear_rmse - d.metrics.diffusion_rmse)) / d.metrics.bilinear_rmse)
    : null

  return (
    <div className="rounded-lg border border-isro/40 bg-isro/5 p-3">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] tracking-[0.14em] text-isro">
            DIFFUSION ENSEMBLE · {varName.toUpperCase()} · CorrDiff-style 0.25°→0.05°
          </span>
          {pctRMSE != null &&
            (pctRMSE >= 0 ? (
              <span className="rounded border border-online/40 bg-online/10 px-1.5 py-0.5 font-mono text-[8px] tracking-[0.08em] text-online">
                +{pctRMSE}% RMSE vs bilinear
              </span>
            ) : (
              <span className="rounded border border-saffron/40 bg-saffron/10 px-1.5 py-0.5 font-mono text-[8px] tracking-[0.08em] text-saffron">
                RMSE +{Math.abs(pctRMSE)}% vs bilinear — wins on CRPS/FSS
              </span>
            ))}
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="rounded-md border border-isro/50 bg-isro/10 px-2 py-1 font-mono text-[9px] tracking-[0.1em] text-ink transition-colors hover:bg-isro/20 disabled:opacity-50"
        >
          {loading ? 'sampling…' : d ? 'RESAMPLE' : 'GENERATE ENSEMBLE'}
        </button>
      </div>
      <div className="mb-2 font-mono text-[8px] text-muted/70">
        SR/diffusion trained on INDmet 0.05° truth · 2020 coverage
      </div>

      {d?.metrics && <MetricCompare m={d.metrics} />}

      {d ? (
        <div className="mt-3 flex flex-wrap items-end justify-center gap-3">
          <DiffThumb title="BILINEAR" sub="Bilinear upsample · 40×60 · ~5.5 km/cell" field={d.bilinear} varName={varName} range={range} contrast={contrast} />
          <span className="pb-7 text-muted/40">→</span>
          <DiffThumb title="DIFFUSION MEAN" sub={`${d.samples}-member ensemble mean · 40×60 · ~5.5 km/cell`} field={d.mean} varName={varName} range={range} contrast={contrast} accent />
          <DiffThumb
            title="UNCERTAINTY ±σ"
            sub="Ensemble spread (σ) · 40×60 · ~5.5 km/cell"
            field={d.std}
            varName={varName}
            range={[0, stdMax]}
            contrast={contrast}
            colorFn={(v) => colorForScale(v, [0, stdMax], 'error', contrast)}
          />
          <DiffThumb title="REAL 0.05°" sub="INDmet 0.05° truth · ~5.5 km/cell" field={d.truth} varName={varName} range={range} contrast={contrast} real />
          {sampleGrids.slice(0, 2).map((sg, i) => (
            <DiffThumb
              key={i}
              title={`SAMPLE ${i + 1}`}
              sub="Stochastic sample · 40×60 · ~5.5 km/cell"
              field={sg}
              varName={varName}
              range={range}
              contrast={contrast}
            />
          ))}
        </div>
      ) : (
        <div className="mt-3 text-center font-mono text-[9px] text-muted/70">
          {err ? <span className="text-danger">{err}</span> : loading
            ? 'sampling a 0.05° ensemble from the coarse field…'
            : 'generate an ensemble of plausible 5 km fields + an uncertainty map for this day'}
        </div>
      )}
      <p className="mt-2 font-mono text-[8px] leading-snug text-muted/70">
        A residual diffusion model samples plausible high-res fields conditioned on the coarse input.
        {varName === 'rainfall'
          ? ' It is scored on spatial/spectral skill — where generative downscaling beats a blurry bilinear.'
          : ' Temperature fields are smooth, so bilinear is already near-optimal and the diffusion over-textures — shown here for honest comparison, not as a win.'}
      </p>
    </div>
  )
}

function MetricCompare({ m }: { m: DiffusionMetrics }) {
  const fmt = (v: number) => v.toFixed(2)
  const rows = [
    { label: 'RMSE ↓', b: m.bilinear_rmse, d: m.diffusion_rmse, win: m.diffusion_rmse < m.bilinear_rmse, fmt },
    // FSS is rainfall-only (a wet-threshold score); skipped for temperature
    ...(m.fss_bilinear != null && m.fss_diffusion != null
      ? [{ label: `FSS@${m.threshold_mm} ↑`, b: m.fss_bilinear, d: m.fss_diffusion, win: m.fss_diffusion > m.fss_bilinear, fmt }]
      : []),
    { label: 'spectrum→1 ↑', b: m.spec_bilinear, d: m.spec_diffusion, win: Math.abs(m.spec_diffusion - 1) < Math.abs(m.spec_bilinear - 1), fmt },
  ]
  return (
    <div>
      <table className="w-full border-separate font-mono text-[10px]" style={{ borderSpacing: '0 2px' }}>
        <thead>
          <tr className="text-[8px] text-muted/70">
            <th className="text-left font-normal">test-split skill</th>
            <th className="text-right font-normal">bilinear</th>
            <th className="text-right font-normal text-online">diffusion</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="text-left text-muted">{r.label}</td>
              <td className="text-right tabular-nums text-ink/80">{r.fmt(r.b)}</td>
              <td className={`text-right tabular-nums ${r.win ? 'text-online' : 'text-saffron'}`}>
                {r.fmt(r.d)} {r.win ? '✓' : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-1 text-center font-mono text-[8px] text-muted/60">
        CRPS {m.crps.toFixed(2)} · {m.n_samples} members · {m.n_days} test days · the generative SOTA answer to the SR-CNN’s double-penalty
      </div>
    </div>
  )
}

function DiffThumb({
  title, sub, field, varName, range, contrast, accent, real, colorFn,
}: {
  title: string; sub: string; field: number[][]; varName: VarName; range: [number, number]
  contrast: number; accent?: boolean; real?: boolean; colorFn?: (v: number) => string
}) {
  const color = real ? COLORS.online : accent ? COLORS.saffron : COLORS.ink
  const outline = real ? 'rgba(54,211,153,0.5)' : accent ? 'rgba(255,138,61,0.5)' : COLORS.line
  // smooth, photographic render of the fine 40×60 field (value-space bilinear + canvas) — the
  // realistic-imagery requirement; falls back to the variable's perceptual palette.
  const fill = colorFn ?? ((v: number) => colorForValue(varName, v, range, contrast))
  return (
    <div className="flex w-[130px] flex-col items-center gap-1">
      <div className="overflow-hidden rounded-md" style={{ outline: `1px solid ${outline}` }}>
        <SmoothField field={field} colorFn={fill} width={130} />
      </div>
      <div className="font-mono text-[9px] tracking-[0.08em]" style={{ color }}>{title}</div>
      <div className="text-center font-mono text-[8px] leading-snug text-muted/70">{sub}</div>
    </div>
  )
}

// --------------------------------------------------------------------------- //
// SPATIAL DETAIL — texture (gradient-energy) bars
// --------------------------------------------------------------------------- //
function TextureBars({ t, hasTruth }: { t: { bilinear: number; srcnn: number; truth: number | null }; hasTruth: boolean }) {
  const rows: Array<{ name: string; v: number; color: string }> = [
    { name: 'bilinear', v: t.bilinear, color: COLORS.isro },
    { name: 'SR-CNN', v: t.srcnn, color: COLORS.online },
  ]
  if (hasTruth && t.truth != null) rows.push({ name: 'real 0.05°', v: t.truth, color: COLORS.saffron })
  const ref = Math.max(...rows.map((r) => r.v), 1e-6)
  return (
    <div className="rounded-md border border-isro/30 bg-isro/5 px-2.5 py-2">
      <div className="mb-1.5 font-mono text-[9px] tracking-[0.12em] text-isro">SPATIAL DETAIL · texture energy</div>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.name} className="flex items-center gap-2">
            <span className="w-16 font-mono text-[9px] text-muted">{r.name}</span>
            <div className="h-2 flex-1 overflow-hidden rounded-sm bg-line/40">
              <div className="h-full rounded-sm" style={{ width: `${Math.min(100, (r.v / ref) * 100)}%`, background: r.color }} />
            </div>
            <span className="w-9 text-right font-mono text-[8px] tabular-nums text-muted">{r.v.toFixed(2)}</span>
          </div>
        ))}
      </div>
      <p className="mt-1.5 font-mono text-[8px] leading-snug text-muted/70">
        mean spatial gradient — SR-CNN recovers more fine detail than a blurry bilinear upsample
        {hasTruth ? ', toward the real 5 km field' : ''}.
      </p>
    </div>
  )
}

// --------------------------------------------------------------------------- //
// POWER SPECTRUM — radial detail-by-scale
// --------------------------------------------------------------------------- //
function SpectrumChart({ s }: { s: { bilinear: number[]; srcnn: number[] } }) {
  const c = useThemeColors()
  const n = Math.max(s.bilinear.length, s.srcnn.length)
  const data = Array.from({ length: n }, (_, i) => ({
    k: i + 1,
    bilinear: (s.bilinear[i] ?? 0) > 0 ? s.bilinear[i] : null,
    srcnn: (s.srcnn[i] ?? 0) > 0 ? s.srcnn[i] : null,
  }))
  if (n < 2) return null
  return (
    <div className="rounded-md border border-line bg-bg/50 px-2.5 py-2">
      <div className="mb-1 font-mono text-[9px] tracking-[0.12em] text-muted">POWER SPECTRUM · detail by scale</div>
      <div className="h-[88px] w-full">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
            <CartesianGrid stroke={c.line} strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="k" tick={{ fill: c.muted, fontSize: 8, fontFamily: 'JetBrains Mono' }} stroke={c.line} />
            <YAxis scale="log" domain={['auto', 'auto']} tick={{ fill: c.muted, fontSize: 7 }} stroke={c.line} width={30} />
            <Line dataKey="bilinear" stroke={c.isro} dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls />
            <Line dataKey="srcnn" stroke={c.online} dot={false} strokeWidth={1.5} isAnimationActive={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="font-mono text-[8px] leading-snug text-muted/70">
        <span className="text-isro">bilinear</span> vs <span className="text-online">SR-CNN</span> — higher
        wavenumber = finer scale; SR-CNN lifts the high-scale tail bilinear flattens.
      </p>
    </div>
  )
}

// --------------------------------------------------------------------------- //
// VALUE DISTRIBUTION — histogram
// --------------------------------------------------------------------------- //
function HistogramChart({ h, hmax }: { h: { bilinear: number[]; srcnn: number[] }; hmax: number }) {
  const c = useThemeColors()
  const bins = h.bilinear.length
  const data = h.bilinear.map((_, i) => ({
    bin: `${Math.round((i / bins) * hmax)}`,
    bilinear: h.bilinear[i],
    srcnn: h.srcnn[i],
  }))
  return (
    <div className="rounded-md border border-line bg-bg/50 px-2.5 py-2">
      <div className="mb-1 font-mono text-[9px] tracking-[0.12em] text-muted">VALUE DISTRIBUTION</div>
      <div className="h-[80px] w-full">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
            <XAxis dataKey="bin" tick={{ fill: c.muted, fontSize: 7 }} stroke={c.line} />
            <YAxis tick={{ fill: c.muted, fontSize: 7 }} stroke={c.line} width={30} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} />
            <Bar dataKey="bilinear" fill={c.isro} opacity={0.7} />
            <Bar dataKey="srcnn" fill={c.online} opacity={0.7} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="font-mono text-[8px] leading-snug text-muted/70">
        value buckets — SR-CNN sharpens the field (fewer mid values, heavier tails) than the smooth bilinear.
      </p>
    </div>
  )
}
