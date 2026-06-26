// Explore.tsx — the map view (M2). Dark vector India with the 9×13 Delhi-NCR grid from
// /state, a layer switch + colorbar, and click-to-select. Same main + right-column layout
// as Overview: map on the left, controls / selected-cell / provenance stacked on the right.

import { useMemo } from 'react'
import DarkIndiaMap from '../map/DarkIndiaMap'
import GridLayer from '../map/GridLayer'
import LayerSwitch from '../controls/LayerSwitch'
import ColorBar from '../controls/ColorBar'
import ProvenanceFooter from '../shell/ProvenanceFooter'
import { gridBounds } from '../../lib/grid'
import type { VarName } from '../../api/types'
import { COLORS } from '../../theme'
import { prettyDate } from '../../lib/format'
import { useAppDispatch, useAppState } from '../../state/useAppState'

export default function Explore() {
  const { state, meta, activeVariable, selectedCell } = useAppState()
  const dispatch = useAppDispatch()

  const res = meta?.res_deg ?? 0.25
  const range = (meta?.colorbar_ranges?.[activeVariable] ?? [0, 1]) as [number, number]
  const bounds = useMemo(() => (state ? gridBounds(state, res) : null), [state, res])

  return (
    <div className="grid h-full grid-cols-1 gap-3 p-3 lg:grid-cols-[1fr_340px]">
      {/* ---- MAIN: map ---- */}
      <section className="relative flex min-h-[480px] flex-col overflow-hidden rounded-xl border border-line bg-panel/40">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="font-mono text-[11px] tracking-[0.22em] text-ink">
            DELHI-NCR · {activeVariable.toUpperCase()}
          </div>
          <div className="font-mono text-[10px] text-muted">
            {state ? prettyDate(state.date) : 'syncing…'}
          </div>
        </div>
        <div className="relative min-h-0 flex-1">
          {state && bounds ? (
            <DarkIndiaMap bounds={bounds}>
              <GridLayer
                state={state}
                variable={activeVariable}
                range={range}
                res={res}
                selected={selectedCell}
                onSelect={(cell) => dispatch({ type: 'SELECT_CELL', cell })}
              />
            </DarkIndiaMap>
          ) : (
            <div className="grid h-full place-items-center font-mono text-xs text-muted">
              loading grid…
            </div>
          )}
        </div>
      </section>

      {/* ---- RIGHT COLUMN ---- */}
      <aside className="flex min-h-0 flex-col gap-3">
        <div className="rounded-xl border border-line bg-panel/40 p-3">
          <PanelTitle>LAYER</PanelTitle>
          <div className="mt-2 space-y-3">
            <LayerSwitch />
            <ColorBar variable={activeVariable} range={range} unit={state?.units[activeVariable]} />
          </div>
        </div>

        <div className="min-h-0 flex-1 rounded-xl border border-line bg-panel/40 p-3">
          <PanelTitle>CELL</PanelTitle>
          <CellReadout />
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

const VARS: VarName[] = ['rainfall', 'tmax', 'tmin']

function CellReadout() {
  const { state, selectedCell, meta } = useAppState()
  if (!selectedCell || !state) {
    return (
      <div className="mt-6 text-center font-mono text-[11px] leading-relaxed text-muted/70">
        click a grid cell
        <br />
        to inspect its values
      </div>
    )
  }
  const { row, col } = selectedCell
  const heatC = meta?.thresholds.heat_stress_tmax_c ?? 40
  const tmax = state.fields.tmax[row]?.[col] ?? NaN
  const hot = tmax >= heatC

  return (
    <div className="mt-2 space-y-2">
      <div className="font-mono text-[11px] text-ink">
        {state.lat[row]?.toFixed(2)}°N, {state.lon[col]?.toFixed(2)}°E
      </div>
      <div className="space-y-1.5">
        {VARS.map((v) => {
          const val = state.fields[v][row]?.[col] ?? NaN
          const alert = v === 'tmax' && hot
          return (
            <div
              key={v}
              className="flex items-center justify-between rounded-md border border-line bg-panel-2/60 px-2.5 py-1.5"
            >
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
                {v}
              </span>
              <span
                className="font-mono text-sm tabular-nums"
                style={{ color: alert ? COLORS.danger : COLORS.ink }}
              >
                {val.toFixed(1)}
                <span className="ml-1 text-[10px] text-muted">{state.units[v]}</span>
              </span>
            </div>
          )
        })}
      </div>
      {hot && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1 font-mono text-[10px] text-danger">
          heat-stress cell (Tmax ≥ {heatC}°C)
        </div>
      )}
    </div>
  )
}
