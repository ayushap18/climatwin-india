// Explore.tsx — the map + timeline view (M3). Dark vector India with the 9×13 Delhi-NCR
// grid driven by a scrub timeline (past observed → forecast). Left: map + TimeSlider.
// Right: layer/model controls, the forecast panel (impacts, sowing, per-cell chart), and
// provenance. Same main + right-column layout as Overview.

import DarkIndiaMap from '../map/DarkIndiaMap'
import Terrain3D from '../map3d/Terrain3D'
import GridLayer from '../map/GridLayer'
import RegionLocator from '../map/RegionLocator'
import RainOverlay from '../map/RainOverlay'
import { SkeletonGrid } from '../ui/Skeleton'
import CompareModal from './CompareModal'
import TimeSlider from '../controls/TimeSlider'
import LayerSwitch from '../controls/LayerSwitch'
import MapModeToggle from '../controls/MapModeToggle'
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
import { getHighres, getTerrain } from '../../api/endpoints'
import { colorForScale } from '../../lib/colormaps'
import type { HighresResp, TerrainResp } from '../../api/types'
import { useTimeline } from '../../state/useTimeline'
import { useAppDispatch, useAppState } from '../../state/useAppState'
import { useActiveSource, useSnapDateToSource } from '../../lib/sources'
import { useEffect, useState } from 'react'

function mean2d(f: number[][]): number {
  let s = 0
  let n = 0
  for (const row of f) for (const x of row) { s += x; n++ }
  return n ? s / n : 0
}

// nearest index in an ascending axis to a target value (used to map a 0.05° hi-res click
// back onto the coarse 0.25° grid that the per-cell forecast series lives on).
function nearestIdx(axis: number[], v: number): number {
  let best = 0
  let bd = Infinity
  for (let i = 0; i < axis.length; i++) {
    const d = Math.abs(axis[i] - v)
    if (d < bd) { bd = d; best = i }
  }
  return best
}

export default function Explore() {
  const { state, meta, model, forecast, activeVariable, selectedCell, horizon, gridContrast } = useAppState()
  const { source: src } = useActiveSource()
  const [compare, setCompare] = useState(false)
  const [anchorDate, setAnchorDate] = useState<string | undefined>(undefined) // undefined → latest
  useSnapDateToSource(anchorDate, setAnchorDate)
  const dispatch = useAppDispatch()
  const tl = useTimeline(anchorDate)

  const res = meta?.res_deg ?? 0.25
  // colorbar range comes from the ACTIVE regime (the 2020 regime has its own ranges + the
  // real LST range); fall back to the top-level meta, then [0,1].
  const srcMeta = meta?.sources?.find((s) => s.key === (src?.key ?? 'synthetic'))
  const range = (srcMeta?.colorbar_ranges?.[activeVariable] ??
    meta?.colorbar_ranges?.[activeVariable] ??
    [0, 1]) as [number, number]
  const unit = state?.units[activeVariable] ?? ''
  const maxH = meta?.max_horizon ?? 14

  // field to render = active timeline frame's field (fallback to NOW state)
  const field = tl.activeData?.fields[activeVariable] ?? state?.fields[activeVariable] ?? null
  const bounds = state ? gridBounds(state.lat, state.lon, res) : null

  // --- INDmet 0.05° high-res OBSERVED layer (real ~5 km data, observed days only) ---
  const [hires, setHires] = useState(false)
  const [hr, setHr] = useState<HighresResp | null>(null)
  const frame = tl.activeFrame
  const hrVarOk = activeVariable !== 'lst' && !!meta?.highres_available && (meta?.highres_vars ?? []).includes(activeVariable)
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

  // --- TERRAIN layer: the real DEM (OpenTopography GLO-30) elevation, a static overlay ---
  const [terrain, setTerrain] = useState(false)
  const [terr, setTerr] = useState<TerrainResp | null>(null)
  useEffect(() => {
    if (!terrain || !meta?.terrain_available) return
    let on = true
    getTerrain()
      .then((r) => on && setTerr(r))
      .catch(() => on && setTerr(null))
    return () => {
      on = false
    }
  }, [terrain, meta?.terrain_available])
  const useTerrain = terrain && !!terr

  // INSAT-3D regime gets the 3D terrain-relief map (distinct from synthetic's flat map).
  const is3D = src?.key === 'insat_real'
  // within the INSAT-3D regime the user can switch between the 3D terrain and a flat 2D map
  const [mapMode, setMapMode] = useState<'3d' | '2d'>('3d')
  const show3D = is3D && mapMode === '3d'
  const [demGrid, setDemGrid] = useState<number[][] | null>(null)
  useEffect(() => {
    if (!is3D || demGrid || !meta?.terrain_available) return
    let on = true
    getTerrain().then((t) => on && setDemGrid(t.field)).catch(() => {})
    return () => {
      on = false
    }
  }, [is3D, demGrid, meta?.terrain_available])

  // resolved render layer (TERRAIN > hi-res > the 0.25° variable grid)
  const useHr = hires && !!hr && !useTerrain
  const rField = useTerrain ? terr!.field : useHr ? hr!.field : field
  const rLat = useTerrain ? terr!.lat : useHr ? hr!.lat : state?.lat
  const rLon = useTerrain ? terr!.lon : useHr ? hr!.lon : state?.lon
  const rRes = useTerrain ? terr!.res_deg : useHr ? hr!.res_deg : res
  const rRange = useTerrain ? terr!.range : useHr ? (hr!.range as [number, number]) : range
  const rBounds = useTerrain
    ? gridBounds(terr!.lat, terr!.lon, terr!.res_deg)
    : useHr
      ? gridBounds(hr!.lat, hr!.lon, hr!.res_deg)
      : bounds
  const rUnit = useTerrain ? terr!.unit : unit

  // rain intensity (0..1) for the animated map overlay — only for the rainfall layer (never terrain)
  const rainIntensity =
    !useTerrain && activeVariable === 'rainfall' && rField
      ? Math.max(0, Math.min(1, mean2d(rField) / 18))
      : 0

  // heat-stress pulse: only highlight ISOLATED hotspots. On a broad heatwave (most cells hot)
  // pulsing every cell just blinks the whole map — the red colormap already tells that story.
  const heatThr = meta?.thresholds.heat_stress_tmax_c ?? 40
  const heatFrac =
    !useTerrain && activeVariable === 'tmax' && rField
      ? rField.flat().filter((v) => v > heatThr).length / Math.max(1, rField.length * (rField[0]?.length ?? 1))
      : 0
  const pulseThreshold = heatFrac > 0 && heatFrac < 0.35 ? heatThr : undefined

  return (
    <div className="grid h-full grid-cols-1 gap-3 p-3 lg:grid-cols-[1fr_340px]">
      {/* ---- MAIN: map + timeline ---- */}
      <section className="relative flex min-h-[520px] flex-col overflow-hidden rounded-xl border border-line bg-panel/40">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.22em] text-ink">
            {(meta?.region ?? 'DELHI-NCR').toUpperCase()} · {useTerrain ? 'ELEVATION' : activeVariable.toUpperCase()}
            {useHr && (
              <span className="rounded border border-online/50 bg-online/10 px-1.5 py-0.5 text-[8px] tracking-[0.1em] text-online">
                0.05° · {hr!.shape[0]}×{hr!.shape[1]} INDmet
              </span>
            )}
            {useTerrain && (
              <span className="rounded border border-saffron/50 bg-saffron/10 px-1.5 py-0.5 text-[8px] tracking-[0.1em] text-saffron">
                {terr!.range[0]}–{terr!.range[1]} m · {terr!.source}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[9px] tracking-[0.12em] text-muted/70">ANCHOR</span>
            <input
              type="date"
              value={anchorDate ?? meta?.latest_date ?? ''}
              min={src?.dateStart ?? meta?.dates.start}
              max={src?.dateEnd ?? meta?.dates.end}
              onChange={(e) => setAnchorDate(e.target.value || undefined)}
              className="rounded border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-ink [color-scheme:dark]"
            />
            {anchorDate && anchorDate !== meta?.latest_date && (
              <button
                onClick={() => setAnchorDate(undefined)}
                title="back to the latest date"
                className="rounded border border-line px-1.5 py-0.5 font-mono text-[9px] text-muted hover:border-isro/40 hover:text-ink"
              >
                NOW
              </button>
            )}
          </div>
        </div>

        <div className="relative min-h-0 flex-1">
          {show3D ? (
            field && demGrid ? (
              <Terrain3D
                field={field}
                dem={demGrid}
                variable={activeVariable}
                range={range}
                unit={unit}
                contrast={gridContrast}
                selected={selectedCell}
                onCellClick={(row, col) => dispatch({ type: 'SELECT_CELL', cell: { row, col } })}
              />
            ) : (
              <SkeletonGrid rows={9} cols={13} />
            )
          ) : state && rBounds && rField && rLat && rLon ? (
            <DarkIndiaMap bounds={rBounds}>
              <GridLayer
                field={rField}
                lat={rLat}
                lon={rLon}
                variable={activeVariable}
                unit={rUnit}
                range={rRange}
                res={rRes}
                contrast={gridContrast}
                colorFn={useTerrain ? (v) => colorForScale(v, rRange, 'elevation', gridContrast) : undefined}
                pulseAbove={pulseThreshold}
                seriesFor={
                  useHr || useTerrain
                    ? undefined
                    : (i, j) => tl.frames.map((f) => tl.getData(f)?.fields[activeVariable]?.[i]?.[j] ?? NaN)
                }
                selected={useHr || useTerrain ? null : selectedCell}
                onSelect={(cell) => {
                  // in 0.05° hi-res mode the grid is 40×60 — map the clicked pixel back to the
                  // coarse 0.25° cell that contains it, so the per-cell forecast series (which
                  // lives on the 9×13 grid) stays in range instead of reading undefined → 0.
                  if (useHr && hr && state) {
                    dispatch({
                      type: 'SELECT_CELL',
                      cell: { row: nearestIdx(state.lat, hr.lat[cell.row]), col: nearestIdx(state.lon, hr.lon[cell.col]) },
                    })
                  } else {
                    dispatch({ type: 'SELECT_CELL', cell })
                  }
                }}
              />
            </DarkIndiaMap>
          ) : (
            <SkeletonGrid rows={9} cols={13} />
          )}
          {!show3D && <RainOverlay intensity={rainIntensity} />}
          {!show3D && <RegionLocator />}
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
            {is3D && <MapModeToggle value={mapMode} onChange={setMapMode} />}
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
            {meta?.terrain_available && (
              <div>
                <button
                  onClick={() => setTerrain((t) => !t)}
                  className={`flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 font-mono text-[10px] tracking-[0.12em] transition-colors ${
                    terrain ? 'border-saffron/60 bg-saffron/10 text-saffron' : 'border-line text-muted hover:border-isro/40 hover:text-ink'
                  }`}
                >
                  <span>⛰ TERRAIN · real DEM</span>
                  <span className={`rounded px-1.5 py-0.5 text-[9px] ${terrain ? 'bg-saffron/30' : 'bg-line'}`}>
                    {terrain ? 'ON' : 'OFF'}
                  </span>
                </button>
                {useTerrain && (
                  <div className="mt-1.5 rounded-md border border-saffron/30 bg-saffron/5 px-2 py-1 font-mono text-[9px] leading-snug text-muted">
                    real elevation {terr!.range[0]}–{terr!.range[1]} m · Copernicus GLO-30 (OpenTopography),
                    the same DEM channel the model uses — Aravalli hills (SW) vs Yamuna plains (E).
                  </div>
                )}
              </div>
            )}
            <button
              onClick={() => setCompare(true)}
              className="w-full rounded-md border border-line px-2 py-1.5 font-mono text-[10px] tracking-[0.12em] text-muted transition-colors hover:border-isro/40 hover:text-ink"
            >
              ⊞ COMPARE MODELS
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto rounded-xl border border-line bg-panel/40 p-3">
          <PanelTitle>FORECAST · {tl.activeFrame?.label ?? '—'}</PanelTitle>
          <ImpactBadges impacts={tl.activeData?.impacts ?? null} />
          {forecast?.analogs?.length ? <AnalogMatches analogs={forecast.analogs} /> : null}
          <SowingCard sowing={forecast?.sowing_window ?? null} />
          {activeVariable === 'lst' ? (
            <div className="py-3 text-center font-mono text-[10px] text-muted/70">
              INSAT-3D LST is an observed satellite layer — no forecast series.
            </div>
          ) : selectedCell && state && selectedCell.row < state.lat.length && selectedCell.col < state.lon.length ? (
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

      {compare && meta && (
        <CompareModal
          date={meta.latest_date}
          variable={activeVariable === 'lst' ? 'tmax' : activeVariable}
          horizon={horizon}
          range={range}
          models={meta.models}
          defaultModel={model ?? meta.default_model}
          contrast={gridContrast}
          onClose={() => setCompare(false)}
        />
      )}
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
