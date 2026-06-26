// Explore.tsx — the map + timeline view (M3). Dark vector India with the 9×13 Delhi-NCR
// grid driven by a scrub timeline (past observed → forecast). Left: map + TimeSlider.
// Right: layer/model controls, the forecast panel (impacts, sowing, per-cell chart), and
// provenance. Same main + right-column layout as Overview.

import DarkIndiaMap from '../map/DarkIndiaMap'
import GridLayer from '../map/GridLayer'
import RegionLocator from '../map/RegionLocator'
import TimeSlider from '../controls/TimeSlider'
import LayerSwitch from '../controls/LayerSwitch'
import ColorBar from '../controls/ColorBar'
import ModelSelect from '../controls/ModelSelect'
import UncertaintyToggle from '../controls/UncertaintyToggle'
import ForecastChart from '../panels/ForecastChart'
import ImpactBadges from '../panels/ImpactBadges'
import SowingCard from '../panels/SowingCard'
import AnalogMatches from '../panels/AnalogMatches'
import ProvenanceFooter from '../shell/ProvenanceFooter'
import HiResToggle from '../controls/HiResToggle'
import { gridBounds } from '../../lib/grid'
import { prettyDate } from '../../lib/format'
import { getHighres } from '../../api/endpoints'
import type { HighresResp } from '../../api/types'
import { useTimeline } from '../../state/useTimeline'
import { useAppDispatch, useAppState } from '../../state/useAppState'
import { useEffect, useState } from 'react'

export default function Explore() {
  const { state, meta, forecast, activeVariable, selectedCell, horizon, gridContrast } = useAppState()
  const dispatch = useAppDispatch()
  const tl = useTimeline()

  const res = meta?.res_deg ?? 0.25
  const range = (meta?.colorbar_ranges?.[activeVariable] ?? [0, 1]) as [number, number]
  const unit = state?.units[activeVariable] ?? ''
  const maxH = meta?.max_horizon ?? 14

  // field to render = active timeline frame's field (fallback to NOW state)
  const field = tl.activeData?.fields[activeVariable] ?? state?.fields[activeVariable] ?? null
  const bounds = state ? gridBounds(state.lat, state.lon, res) : null

  // --- INDmet 0.05° high-res OBSERVED layer (real ~5 km data, observed days only) ---
  const [hires, setHires] = useState(false)
  const [hr, setHr] = useState<HighresResp | null>(null)
  const frame = tl.activeFrame
  const hrVarOk = !!meta?.highres_available && (meta?.highres_vars ?? []).includes(activeVariable)
  const hrDateOk = frame?.kind === 'observed' || frame?.kind === 'now'
  useEffect(() => {
    if (!hires || !hrVarOk || !hrDateOk || !frame?.date) {
      setHr(null)
      return
    }
    let on = true
    getHighres(frame.date, activeVariable)
      .then((r) => on && setHr(r))
      .catch(() => on && setHr(null))
    return () => {
      on = false
    }
  }, [hires, hrVarOk, hrDateOk, frame?.date, activeVariable])

  // when the high-res layer is active, render it instead of the 0.25° grid
  const useHr = hires && !!hr
  const rField = useHr ? hr!.field : field
  const rLat = useHr ? hr!.lat : state?.lat
  const rLon = useHr ? hr!.lon : state?.lon
  const rRes = useHr ? hr!.res_deg : res
  const rRange = useHr ? (hr!.range as [number, number]) : range
  const rBounds = useHr ? gridBounds(hr!.lat, hr!.lon, hr!.res_deg) : bounds

  return (
    <div className="grid h-full grid-cols-1 gap-3 p-3 lg:grid-cols-[1fr_340px]">
      {/* ---- MAIN: map + timeline ---- */}
      <section className="relative flex min-h-[520px] flex-col overflow-hidden rounded-xl border border-line bg-panel/40">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.22em] text-ink">
            {(meta?.region ?? 'DELHI-NCR').toUpperCase()} · {activeVariable.toUpperCase()}
            {useHr && (
              <span className="rounded border border-online/50 bg-online/10 px-1.5 py-0.5 text-[8px] tracking-[0.1em] text-online">
                0.05° · {hr!.shape[0]}×{hr!.shape[1]} INDmet
              </span>
            )}
          </div>
          <div className="font-mono text-[10px] text-muted">
            {tl.activeFrame ? prettyDate(tl.activeFrame.date) : 'syncing…'}
          </div>
        </div>

        <div className="relative min-h-0 flex-1">
          {state && rBounds && rField && rLat && rLon ? (
            <DarkIndiaMap bounds={rBounds}>
              <GridLayer
                field={rField}
                lat={rLat}
                lon={rLon}
                variable={activeVariable}
                unit={unit}
                range={rRange}
                res={rRes}
                contrast={gridContrast}
                selected={useHr ? null : selectedCell}
                onSelect={(cell) => dispatch({ type: 'SELECT_CELL', cell })}
              />
            </DarkIndiaMap>
          ) : (
            <div className="grid h-full place-items-center font-mono text-xs text-muted">
              loading grid…
            </div>
          )}
          <RegionLocator />
        </div>

        <TimeSlider
          frames={tl.frames}
          index={tl.index}
          nowIndex={tl.nowIndex}
          playing={tl.playing}
          onScrub={tl.setIndex}
          onTogglePlay={tl.togglePlay}
        />
      </section>

      {/* ---- RIGHT COLUMN ---- */}
      <aside className="flex min-h-0 flex-col gap-3">
        <div className="rounded-xl border border-line bg-panel/40 p-3">
          <PanelTitle>LAYER &amp; MODEL</PanelTitle>
          <div className="mt-2 space-y-2.5">
            <LayerSwitch />
            <ColorBar variable={activeVariable} range={range} unit={unit} />
            <ModelSelect />
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] tracking-[0.12em] text-muted">HORIZON</span>
              <div className="flex items-center gap-2">
                <Stepper
                  label="−"
                  onClick={() => dispatch({ type: 'SET_HORIZON', horizon: Math.max(1, horizon - 1) })}
                />
                <span className="w-10 text-center font-mono text-xs text-ink tabular-nums">
                  {horizon}d
                </span>
                <Stepper
                  label="+"
                  onClick={() =>
                    dispatch({ type: 'SET_HORIZON', horizon: Math.min(maxH, horizon + 1) })
                  }
                />
              </div>
            </div>
            <UncertaintyToggle />
            <HiResToggle
              on={hires}
              onChange={setHires}
              available={!!meta?.highres_available}
              activeOk={useHr}
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-xl border border-line bg-panel/40 p-3">
          <PanelTitle>FORECAST · {tl.activeFrame?.label ?? '—'}</PanelTitle>
          <ImpactBadges impacts={tl.activeData?.impacts ?? null} />
          {forecast?.analogs?.length ? <AnalogMatches analogs={forecast.analogs} /> : null}
          <SowingCard sowing={forecast?.sowing_window ?? null} />
          {selectedCell && state ? (
            <div>
              <div className="mb-1 font-mono text-[10px] text-muted">
                CELL {state.lat[selectedCell.row]?.toFixed(2)}°N,{' '}
                {state.lon[selectedCell.col]?.toFixed(2)}°E
              </div>
              <ForecastChart
                frames={tl.frames}
                getData={tl.getData}
                variable={activeVariable}
                unit={unit}
                cell={selectedCell}
                nowDate={meta?.latest_date ?? ''}
              />
            </div>
          ) : (
            <div className="py-3 text-center font-mono text-[10px] text-muted/70">
              click a cell for its forecast series
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

function Stepper({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="grid h-6 w-6 place-items-center rounded border border-line font-mono text-xs text-muted transition-colors hover:border-isro/50 hover:text-ink"
    >
      {label}
    </button>
  )
}
