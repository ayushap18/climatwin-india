// ScenarioDeltas.tsx — baseline → scenario impact deltas with direction arrows. Heat-stress
// and dryness cells flash danger when the scenario crosses a stress threshold; the arrow
// color encodes whether the change is adverse (hotter/drier) or benign.

import type { Impacts, SowingWindow } from '../../api/types'
import { COLORS } from '../../theme'

interface Row {
  label: string
  base: number
  scen: number
  unit: string
  digits: number
  adverseUp: boolean // is an increase the "bad" direction?
}

export default function ScenarioDeltas({
  baseline,
  scenario,
  heatThreshold,
  sowingBase,
  sowingScen,
}: {
  baseline: Impacts | null
  scenario: Impacts | null
  heatThreshold: number
  sowingBase: SowingWindow | null
  sowingScen: SowingWindow | null
}) {
  if (!baseline || !scenario) return null

  const rows: Row[] = [
    { label: 'HEAT STRESS', base: baseline.heat_stress_fraction * 100, scen: scenario.heat_stress_fraction * 100, unit: '%', digits: 0, adverseUp: true },
    { label: 'MAX TMAX', base: baseline.max_tmax_c, scen: scenario.max_tmax_c, unit: '°C', digits: 1, adverseUp: true },
    { label: 'MEAN RAIN', base: baseline.mean_rainfall_mm, scen: scenario.mean_rainfall_mm, unit: 'mm', digits: 1, adverseUp: false },
    { label: 'DRYNESS', base: baseline.dryness_index, scen: scenario.dryness_index, unit: '', digits: 2, adverseUp: false },
  ]

  return (
    <div className="space-y-1.5">
      {rows.map((r) => {
        const delta = r.scen - r.base
        const up = delta > 0.0001
        const down = delta < -0.0001
        const adverse = (up && r.adverseUp) || (down && !r.adverseUp)
        const arrow = up ? '▲' : down ? '▼' : '–'
        const color = !up && !down ? COLORS.muted : adverse ? COLORS.danger : COLORS.online
        const crossesHeat = r.label === 'MAX TMAX' && scenario.max_tmax_c >= heatThreshold && baseline.max_tmax_c < heatThreshold
        return (
          <div
            key={r.label}
            className="flex items-center justify-between rounded-md border px-2.5 py-1.5"
            style={{
              borderColor: crossesHeat ? 'rgba(255,84,112,0.5)' : COLORS.line,
              background: crossesHeat ? 'rgba(255,84,112,0.08)' : undefined,
            }}
          >
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted">
              {r.label}
            </span>
            <span className="flex items-baseline gap-1.5 font-mono tabular-nums">
              <span className="text-[11px] text-muted/70">
                {r.base.toFixed(r.digits)}
              </span>
              <span className="text-[9px] text-muted">→</span>
              <span className="text-sm text-ink">
                {r.scen.toFixed(r.digits)}
                {r.unit}
              </span>
              <span className="text-[10px]" style={{ color }}>
                {arrow}
                {Math.abs(delta) >= 0.01 ? Math.abs(delta).toFixed(r.digits) : ''}
              </span>
            </span>
          </div>
        )
      })}

      {sowingBase && sowingScen && (
        <div className="flex items-center justify-between rounded-md border border-line bg-panel-2/50 px-2.5 py-1.5">
          <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted">SOWING ONSET</span>
          <span className="flex items-baseline gap-1.5 font-mono">
            <span className="text-[11px] text-muted/70">
              {sowingBase.sowing_ok ? `+${sowingBase.onset_lead_day}d` : '—'}
            </span>
            <span className="text-[9px] text-muted">→</span>
            <span
              className="text-sm"
              style={{ color: sowingScen.sowing_ok ? COLORS.ink : COLORS.danger }}
            >
              {sowingScen.sowing_ok ? `+${sowingScen.onset_lead_day}d` : 'NONE'}
            </span>
          </span>
        </div>
      )}
    </div>
  )
}
