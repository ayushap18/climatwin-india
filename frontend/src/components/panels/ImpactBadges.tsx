// ImpactBadges.tsx — decision signals for the active frame's impacts. Heat-stress and
// dryness badges turn danger-red when their thresholds are crossed.

import type { Impacts } from '../../api/types'
import { COLORS } from '../../theme'
import { pct } from '../../lib/format'

export default function ImpactBadges({ impacts }: { impacts: Impacts | null }) {
  if (!impacts) return null
  const hot = impacts.heat_stress_fraction > 0
  const dry = impacts.dryness_index < -0.5

  const items = [
    { label: 'HEAT STRESS', value: pct(impacts.heat_stress_fraction), alert: hot, accent: COLORS.danger },
    { label: 'MEAN RAIN', value: `${impacts.mean_rainfall_mm} mm`, alert: false, accent: COLORS.isro },
    { label: 'MAX TMAX', value: `${impacts.max_tmax_c}°C`, alert: hot, accent: COLORS.saffron },
    { label: 'DRYNESS', value: impacts.dryness_index.toFixed(2), alert: dry, accent: COLORS.online },
  ]

  return (
    <div className="grid grid-cols-2 gap-1.5">
      {items.map((it) => (
        <div
          key={it.label}
          className="rounded-md border bg-panel-2/60 px-2.5 py-1.5"
          style={{
            borderColor: it.alert ? 'rgba(255,84,112,0.5)' : COLORS.line,
            background: it.alert ? 'rgba(255,84,112,0.08)' : undefined,
          }}
        >
          <div className="font-mono text-[8px] uppercase tracking-[0.15em] text-muted">
            {it.label}
          </div>
          <div
            className="font-mono text-sm tabular-nums"
            style={{ color: it.alert ? COLORS.danger : it.accent }}
          >
            {it.value}
          </div>
        </div>
      ))}
    </div>
  )
}
