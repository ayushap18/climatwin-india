// Downscale.tsx — SR-CNN super-resolution demo (M6). Coarsen the true field to ~1°, then
// compare bilinear upsampling vs the SR-CNN reconstruction at 0.25°, with the improvement %.
// Hidden from the nav when no checkpoint exists (this deployment); renders a clear note if
// the endpoint 503s anyway. Built so it lights up on a full backend.

import { useEffect, useMemo, useState } from 'react'
import ProvenanceFooter from '../shell/ProvenanceFooter'
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
      {/* ---- MAIN: coarse -> bilinear -> SR-CNN ---- */}
      <section className="relative flex min-h-[480px] flex-col overflow-hidden rounded-xl border border-line bg-panel/40">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="font-mono text-[11px] tracking-[0.22em] text-ink">
            SUPER-RESOLUTION · {varName.toUpperCase()}
          </div>
          <div className="font-mono text-[10px] text-muted">{ds ? ds.date : ''}</div>
        </div>

        <div className="flex flex-1 flex-wrap items-center justify-center gap-4 p-6">
          {ds ? (
            <>
              <Thumb title="COARSE ~1°" field={ds.coarse} varName={varName} range={range} contrast={gridContrast} />
              <Arrow />
              <Thumb
                title="BILINEAR"
                sub={ds.bilinear_rmse != null ? `RMSE ${ds.bilinear_rmse.toFixed(2)}` : ''}
                field={ds.bilinear}
                varName={varName}
                range={range} contrast={gridContrast}
              />
              <Arrow />
              <Thumb
                title="SR-CNN"
                sub={ds.srcnn_rmse != null ? `RMSE ${ds.srcnn_rmse.toFixed(2)}` : ''}
                field={ds.srcnn}
                varName={varName}
                range={range}
                highlight contrast={gridContrast}
              />
            </>
          ) : (
            <div className="max-w-md text-center font-mono text-xs leading-relaxed text-muted">
              {error ? (
                <>
                  <div className="text-danger">downscaler unavailable</div>
                  <div className="mt-2">{error}</div>
                  <div className="mt-2 text-muted/70">
                    train it with <span className="text-ink">make downscale</span> to enable this view.
                  </div>
                </>
              ) : (
                'loading…'
              )}
            </div>
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

        <div className="min-h-0 flex-1 rounded-xl border border-line bg-panel/40 p-3">
          <PanelTitle>RECONSTRUCTION SKILL</PanelTitle>
          {ds ? (
            <div className="mt-3 space-y-2 font-mono text-[11px]">
              <Stat label="bilinear RMSE" value={ds.bilinear_rmse?.toFixed(3) ?? '—'} />
              <Stat label="SR-CNN RMSE" value={ds.srcnn_rmse?.toFixed(3) ?? '—'} accent={COLORS.online} />
              <div className="mt-3 rounded-md border border-online/30 bg-online/5 px-3 py-2 text-center">
                <div className="text-[9px] uppercase tracking-[0.15em] text-muted">improvement</div>
                <div className="text-xl text-online">
                  {ds.improvement_pct != null ? `${ds.improvement_pct}%` : '—'}
                </div>
                <div className="text-[9px] text-muted">SR-CNN vs bilinear</div>
              </div>
            </div>
          ) : (
            <div className="mt-3 font-mono text-[10px] text-muted">{error ?? 'loading…'}</div>
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
  return (
    <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">{children}</div>
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

function Arrow() {
  return <span className="font-mono text-lg text-muted/60">→</span>
}

function Thumb({
  title,
  sub,
  field,
  varName,
  range,
  highlight,
  contrast = 1,
}: {
  title: string
  sub?: string
  field: number[][]
  varName: VarName
  range: [number, number]
  highlight?: boolean
  contrast?: number
}) {
  const w = 168
  const rows = field.length
  const cols = field[0]?.length ?? 1
  const cell = w / cols
  const h = cell * rows
  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg
        width={w}
        height={h}
        className="rounded-md"
        style={{
          boxShadow: highlight ? '0 0 24px -6px rgba(54,211,153,0.6)' : undefined,
          outline: highlight ? '1px solid rgba(54,211,153,0.4)' : '1px solid #1b2742',
        }}
      >
        {field.map((row, i) =>
          row.map((val, j) => (
            <rect
              key={`${i}-${j}`}
              x={j * cell}
              y={(rows - 1 - i) * cell}
              width={cell + 0.5}
              height={cell + 0.5}
              fill={colorForValue(varName, val, range, contrast)}
            />
          )),
        )}
      </svg>
      <div className="font-mono text-[10px] tracking-[0.12em] text-ink">{title}</div>
      {sub && <div className="font-mono text-[9px] text-muted">{sub}</div>}
    </div>
  )
}
