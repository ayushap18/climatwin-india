// WhatIf.tsx — the counterfactual view (M4). Perturb ΔTemp / rainfall× / urban-heat (with a
// drawable urban polygon) and POST /whatif; the diverging diff heatmap and baseline→scenario
// impact deltas update live (debounced). Same main + right-column layout as the other views.

import { useEffect, useMemo, useState } from 'react'
import DarkIndiaMap from '../map/DarkIndiaMap'
import RegionLocator from '../map/RegionLocator'
import DiffLayer from '../map/DiffLayer'
import UrbanDrawTool from '../map/UrbanDrawTool'
import LayerSwitch from '../controls/LayerSwitch'
import WhatIfPanel from '../whatif/WhatIfPanel'
import ScenarioDeltas from '../whatif/ScenarioDeltas'
import ProvenanceFooter from '../shell/ProvenanceFooter'
import { postWhatIf } from '../../api/endpoints'
import type { WhatIfResp } from '../../api/types'
import { gridBounds } from '../../lib/grid'
import { COLORMAPS } from '../../theme'
import { prettyDate } from '../../lib/format'
import { useAppState } from '../../state/useAppState'
import { useActiveSource, useSnapDateToSource } from '../../lib/sources'

function maxAbs(grid: number[][]): number {
  let m = 0
  for (const row of grid) for (const v of row) if (Math.abs(v) > m) m = Math.abs(v)
  return m
}

export default function WhatIf() {
  const { meta, state, model, activeVariable, horizon, gridContrast } = useAppState()
  const { source: src } = useActiveSource()

  const defaultDate = useMemo(
    () => (meta ? `${meta.latest_date.slice(0, 4)}-05-22` : ''),
    [meta],
  )
  const [date, setDate] = useState('')
  useSnapDateToSource(date, setDate)
  useEffect(() => {
    if (!date && defaultDate) setDate(defaultDate)
  }, [defaultDate, date])

  // open on a mild illustrative scenario so the diff map isn't blank on first paint
  const [deltaTemp, setDeltaTemp] = useState(2)
  const [rainPct, setRainPct] = useState(90)
  const [urbanLst, setUrbanLst] = useState(2)
  const [urbanPoints, setUrbanPoints] = useState<[number, number][]>([])
  const [drawMode, setDrawMode] = useState(false)
  const [leadDay, setLeadDay] = useState(horizon)
  const [result, setResult] = useState<WhatIfResp | null>(null)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    setLeadDay((l) => Math.min(Math.max(1, l), horizon))
  }, [horizon])

  // debounced auto-run
  useEffect(() => {
    if (!date) return
    const t = window.setTimeout(() => {
      setRunning(true)
      postWhatIf({
        date,
        horizon,
        delta_temp: deltaTemp,
        rain_factor: rainPct / 100,
        urban_lst: urbanLst,
        urban_polygon: urbanPoints.length >= 3 ? urbanPoints : undefined,
        model: model ?? undefined,
      })
        .then(setResult)
        .catch(() => {})
        .finally(() => setRunning(false))
    }, 350)
    return () => window.clearTimeout(t)
  }, [date, horizon, deltaTemp, rainPct, urbanLst, urbanPoints, model])

  const res = meta?.res_deg ?? 0.25
  // a read-only regime (no trained model) returns { pending } with no days/grid
  const ok = result && !result.pending ? result : null
  const isPending = !!result?.pending
  const latArr = ok?.lat ?? state?.lat
  const lonArr = ok?.lon ?? state?.lon
  const bounds = latArr && lonArr ? gridBounds(latArr, lonArr, res) : null
  const unit = ok?.units[activeVariable] ?? state?.units[activeVariable] ?? ''

  const day = ok ? (ok.days[Math.min(leadDay, ok.days.length) - 1] ?? null) : null
  const diff = day?.diff[activeVariable] ?? null
  const magnitude = diff ? Math.max(0.5, maxAbs(diff)) : 1

  return (
    <div className="grid h-full grid-cols-1 gap-3 p-3 lg:grid-cols-[1fr_360px]">
      {/* ---- MAIN: diff map ---- */}
      <section className="relative flex min-h-[520px] flex-col overflow-hidden rounded-xl border border-line bg-panel/40">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="font-mono text-[11px] tracking-[0.22em] text-ink">
            SCENARIO DIFF · Δ{activeVariable.toUpperCase()}
          </div>
          <div className="font-mono text-[10px] text-muted">
            {day ? `${prettyDate(day.date)} · +${day.lead_day}d` : 'syncing…'}
          </div>
        </div>

        <div className="relative min-h-0 flex-1">
          {bounds && latArr && lonArr ? (
            <DarkIndiaMap bounds={bounds} basemap={src?.key === 'insat_real' ? 'mosdac' : 'default'}>
              {diff && (
                <DiffLayer diff={diff} lat={latArr} lon={lonArr} magnitude={magnitude} res={res} contrast={gridContrast} />
              )}
              <UrbanDrawTool
                active={drawMode}
                points={urbanPoints}
                onAddPoint={(p) => setUrbanPoints((pts) => [...pts, p])}
              />
            </DarkIndiaMap>
          ) : (
            <div className="grid h-full place-items-center px-6 text-center font-mono text-xs text-muted">
              {isPending
                ? (result?.reason ?? 'this regime is read-only — no trained model yet')
                : 'loading scenario…'}
            </div>
          )}
          <RegionLocator />
        </div>

        {/* lead-day scrub for the diff */}
        <div className="flex items-center gap-3 border-t border-line bg-panel/70 px-4 py-2.5">
          <span className="font-mono text-[10px] tracking-[0.12em] text-muted">LEAD</span>
          <input
            type="range"
            min={1}
            max={horizon}
            value={leadDay}
            onChange={(e) => setLeadDay(Number(e.target.value))}
            className="ct-range flex-1"
          />
          <span className="w-24 text-right font-mono text-[11px] text-saffron tabular-nums">
            +{leadDay}d / {horizon}d
          </span>
        </div>
      </section>

      {/* ---- RIGHT COLUMN ---- */}
      <aside className="flex min-h-0 flex-col gap-3">
        <div className="rounded-xl border border-line bg-panel/40 p-3">
          <PanelTitle>SCENARIO</PanelTitle>
          <div className="mt-2 space-y-3">
            <LayerSwitch />
            <WhatIfPanel
              date={date}
              dateMin={src?.dateStart ?? meta?.dates.start ?? ''}
              dateMax={src?.dateEnd ?? meta?.dates.end ?? ''}
              onDate={setDate}
              deltaTemp={deltaTemp}
              onDeltaTemp={setDeltaTemp}
              rainPct={rainPct}
              onRainPct={setRainPct}
              urbanLst={urbanLst}
              onUrbanLst={setUrbanLst}
              drawMode={drawMode}
              onToggleDraw={() => setDrawMode((d) => !d)}
              urbanPoints={urbanPoints.length}
              urbanCells={ok?.scenario_params.urban_cells ?? null}
              onClearUrban={() => {
                setUrbanPoints([])
                setDrawMode(false)
              }}
              running={running}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto rounded-xl border border-line bg-panel/40 p-3">
          <PanelTitle>IMPACT · BASELINE → SCENARIO</PanelTitle>
          <DiffLegend magnitude={magnitude} unit={unit} />
          <ScenarioDeltas
            baseline={day?.impacts_baseline ?? null}
            scenario={day?.impacts_scenario ?? null}
            heatThreshold={meta?.thresholds.heat_stress_tmax_c ?? 40}
            sowingBase={ok?.sowing_baseline ?? null}
            sowingScen={ok?.sowing_scenario ?? null}
          />
          {src && src.key !== 'synthetic' && (
            <div className="rounded-md border border-saffron/30 bg-saffron/5 px-2.5 py-2 font-mono text-[9px] leading-relaxed text-saffron/90">
              {src.label} — baseline is the real INSAT-3D observation; the scenario re-simulates a
              single-year ({src.dateStart.slice(0, 4)}) real-LST model under your perturbation, so
              treat absolute values as indicative of direction, not calibrated magnitude.
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
  return (
    <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">{children}</div>
  )
}

function DiffLegend({ magnitude, unit }: { magnitude: number; unit: string }) {
  const stops = COLORMAPS.diff.map(([pos, hex]) => `${hex} ${Math.round(pos * 100)}%`).join(', ')
  return (
    <div>
      <div
        className="h-2.5 w-full rounded-full border border-line"
        style={{ background: `linear-gradient(90deg, ${stops})` }}
      />
      <div className="mt-1 flex justify-between font-mono text-[9px] text-muted">
        <span>−{magnitude.toFixed(1)} {unit}</span>
        <span className="text-muted/70">Δ = scenario − baseline</span>
        <span>+{magnitude.toFixed(1)} {unit}</span>
      </div>
    </div>
  )
}
