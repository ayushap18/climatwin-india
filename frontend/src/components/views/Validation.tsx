// Validation.tsx — honest, baseline-relative skill (M6). Main: the per-cell Tmax RMSE error
// map for the selected model/horizon. Right: horizon + model selectors, the metrics table
// (RMSE/MAE/corr + rain POD/FAR/CSI, winner highlighted), the honesty note, and provenance.

import { useEffect, useMemo, useState } from 'react'
import DarkIndiaMap from '../map/DarkIndiaMap'
import ErrorLayer from '../map/ErrorLayer'
import MetricsTable from '../panels/MetricsTable'
import InfoPopover from '../panels/InfoPopover'
import ProvenanceFooter from '../shell/ProvenanceFooter'
import { getValidate } from '../../api/endpoints'
import type { ValidateResp } from '../../api/types'
import { gridBounds } from '../../lib/grid'
import { COLORMAPS } from '../../theme'
import { useAppState } from '../../state/useAppState'

function maxOf(grid: number[][]): number {
  let m = 0
  for (const row of grid) for (const x of row) if (x > m) m = x
  return m
}

export default function Validation() {
  const { meta } = useAppState()
  const res = meta?.res_deg ?? 0.25
  const [v, setV] = useState<ValidateResp | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [horizon, setHorizon] = useState<string>('1')
  const [model, setModel] = useState<string>('')

  useEffect(() => {
    let on = true
    getValidate()
      .then((res2) => {
        if (!on) return
        setV(res2)
        setHorizon(Object.keys(res2.horizons)[0] ?? '1')
        setModel(res2.summary_rmse[Object.keys(res2.horizons)[0]]?.tmax?.best as string ?? res2.models[0])
      })
      .catch((e) => on && setError(e.message))
    return () => {
      on = false
    }
  }, [])

  const errField = v?.horizons[horizon]?.[model]?.error_map_tmax_rmse ?? null
  const range = useMemo<[number, number]>(
    () => (errField ? [0, Math.max(0.5, maxOf(errField))] : [0, 1]),
    [errField],
  )
  const bounds = v ? gridBounds(v.lat, v.lon, res) : null

  return (
    <div className="grid h-full grid-cols-1 gap-3 p-3 lg:grid-cols-[1fr_360px]">
      {/* ---- MAIN: error map ---- */}
      <section className="relative flex min-h-[480px] flex-col overflow-hidden rounded-xl border border-line bg-panel/40">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.22em] text-ink">
            TMAX RMSE · {model || '—'} · {horizon}d
            <InfoPopover>
              Per-cell root-mean-square error of next-{horizon}-day Tmax over the temporal test
              split. Darker = lower error (better). This is the spatial view of the table at right.
            </InfoPopover>
          </div>
          <div className="font-mono text-[10px] text-muted">test split</div>
        </div>
        <div className="relative min-h-0 flex-1">
          {bounds && v && errField ? (
            <DarkIndiaMap bounds={bounds}>
              <ErrorLayer field={errField} lat={v.lat} lon={v.lon} range={range} unit="°C" res={res} />
            </DarkIndiaMap>
          ) : (
            <div className="grid h-full place-items-center font-mono text-xs text-muted">
              {error ? `validation unavailable: ${error}` : 'loading metrics…'}
            </div>
          )}
        </div>
      </section>

      {/* ---- RIGHT COLUMN ---- */}
      <aside className="flex min-h-0 flex-col gap-3">
        <div className="rounded-xl border border-line bg-panel/40 p-3">
          <PanelTitle>CONFIG</PanelTitle>
          <div className="mt-2 space-y-2.5">
            <Row label="HORIZON">
              <Segmented
                options={v ? Object.keys(v.horizons) : ['1']}
                value={horizon}
                onChange={setHorizon}
                suffix="d"
              />
            </Row>
            <Row label="ERROR MAP">
              <Segmented options={v?.models ?? []} value={model} onChange={setModel} />
            </Row>
            <ErrorBar range={range} />
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-xl border border-line bg-panel/40 p-3">
          <PanelTitle>SKILL · {horizon}d · vs BASELINES</PanelTitle>
          {v ? (
            <>
              <MetricsTable v={v} horizon={horizon} />
              <div className="rounded-md border border-isro/20 bg-isro/5 px-2.5 py-2 font-mono text-[9px] leading-relaxed text-muted">
                {v.note}
              </div>
            </>
          ) : (
            <div className="font-mono text-[10px] text-muted">{error ?? 'loading…'}</div>
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="font-mono text-[10px] tracking-[0.12em] text-muted">{label}</span>
      {children}
    </div>
  )
}

function Segmented({
  options,
  value,
  onChange,
  suffix = '',
}: {
  options: string[]
  value: string
  onChange: (v: string) => void
  suffix?: string
}) {
  return (
    <div className="flex gap-1">
      {options.map((o) => {
        const active = value === o
        return (
          <button
            key={o}
            onClick={() => onChange(o)}
            className={`rounded-md border px-2 py-1 font-mono text-[10px] tracking-[0.08em] transition-colors ${
              active
                ? 'border-saffron/60 bg-saffron/10 text-saffron'
                : 'border-line text-muted hover:border-isro/40 hover:text-ink'
            }`}
          >
            {o}
            {suffix}
          </button>
        )
      })}
    </div>
  )
}

function ErrorBar({ range }: { range: [number, number] }) {
  const stops = COLORMAPS.error.map(([p, hex]) => `${hex} ${Math.round(p * 100)}%`).join(', ')
  return (
    <div>
      <div
        className="h-2.5 w-full rounded-full border border-line"
        style={{ background: `linear-gradient(90deg, ${stops})` }}
      />
      <div className="mt-1 flex justify-between font-mono text-[9px] text-muted">
        <span>{range[0].toFixed(1)}°C</span>
        <span className="text-muted/70">Tmax RMSE</span>
        <span>{range[1].toFixed(1)}°C</span>
      </div>
    </div>
  )
}
