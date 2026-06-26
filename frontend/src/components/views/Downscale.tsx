// Downscale.tsx — SR-CNN super-resolution. Coarsen the true field to ~1°, then compare
// bilinear vs the SR-CNN reconstruction at 0.25° with an interactive reveal slider and the
// % improvement. Hidden from the nav when no checkpoint exists; renders a designed
// explainer (pipeline + math) if reached anyway. Built so it lights up on a full backend.

import { useEffect, useMemo, useRef, useState } from 'react'
import ProvenanceFooter from '../shell/ProvenanceFooter'
import InfoPopover from '../panels/InfoPopover'
import { getDownscale } from '../../api/endpoints'
import type { DownscaleResp, VarName } from '../../api/types'
import { colorForValue } from '../../lib/colormaps'
import { useAppState } from '../../state/useAppState'
import { COLORS } from '../../theme'

const VARS: VarName[] = ['rainfall', 'tmax', 'tmin']

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
  const [varName, setVarName] = useState<VarName>('rainfall')
  const [ds, setDs] = useState<DownscaleResp | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let on = true
    setError(null)
    setDs(null)
    getDownscale(undefined, varName)
      .then((r) => on && setDs(r))
      .catch((e) => on && setError(e.message))
    return () => {
      on = false
    }
  }, [varName])

  const range = useMemo<[number, number]>(
    () => (ds ? dataRange(ds.srcnn) : (meta?.colorbar_ranges[varName] ?? [0, 1])),
    [ds, meta, varName],
  )

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
          <div className="font-mono text-[10px] text-muted">{ds ? ds.date : ''}</div>
        </div>

        {/* pipeline strip — always shown */}
        <div className="flex items-center justify-center gap-2 border-b border-line px-4 py-2 font-mono text-[9px] text-muted">
          <Pill>COARSE ~1°</Pill>→<Pill>BILINEAR</Pill>
          <span className="text-muted/50">vs</span>
          <Pill accent>SR-CNN</Pill>→
          <span className="text-online">imp% = 100·(RMSEᵦ − RMSEₛ)/RMSEᵦ</span>
        </div>

        <div className="flex flex-1 flex-wrap items-center justify-center gap-6 p-6">
          {ds ? (
            <>
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
            </>
          ) : error ? (
            <UnavailableExplainer error={error} />
          ) : (
            <div className="font-mono text-xs text-muted">loading…</div>
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
                <div className="text-[9px] text-muted">SR-CNN vs bilinear</div>
              </div>
            </div>
          ) : (
            <div className="font-mono text-[10px] text-muted">{error ?? 'loading…'}</div>
          )}
          <div className="rounded-md border border-line bg-bg/50 px-2.5 py-2 font-mono text-[9px] leading-relaxed text-muted/80">
            <div className="mb-1 text-isro">how it works</div>
            1 · coarsen the true 0.25° field to ~1° (block-mean).<br />
            2 · upsample back two ways — bilinear vs a trained SR-CNN.<br />
            3 · score each against the truth; lower RMSE wins.
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

function UnavailableExplainer({ error }: { error: string }) {
  return (
    <div className="max-w-lg text-center">
      <div className="mb-4 flex items-center justify-center gap-2">
        <PlaceholderTile label="COARSE ~1°" />
        <span className="text-muted/50">→</span>
        <PlaceholderTile label="BILINEAR" />
        <span className="text-muted/50">vs</span>
        <PlaceholderTile label="SR-CNN" accent />
      </div>
      <div className="font-mono text-xs text-danger">downscaler unavailable in this deployment</div>
      <div className="mt-2 font-mono text-[11px] leading-relaxed text-muted">{error}</div>
      <div className="mt-3 font-mono text-[11px] text-muted/80">
        Train the SR-CNN with <span className="text-ink">make downscale</span> and this view lights
        up: drag-to-compare the two reconstructions with the live % improvement.
      </div>
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
}: {
  field: number[][]
  varName: VarName
  range: [number, number]
  contrast: number
  w: number
}) {
  const rows = field.length
  const cols = field[0]?.length ?? 1
  const cell = w / cols
  const h = cell * rows
  const gap = 1.5
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
            rx={2}
            fill={colorForValue(varName, val, range, contrast)}
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
