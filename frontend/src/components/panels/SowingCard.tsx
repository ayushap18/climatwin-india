// SowingCard.tsx — the sowing-window decision signal from /forecast.sowing_window:
// whether accumulated rainfall crosses the onset threshold over the horizon, and when.

import type { SowingWindow } from '../../api/types'
import { COLORS } from '../../theme'

export default function SowingCard({ sowing }: { sowing: SowingWindow | null }) {
  if (!sowing) return null
  const ok = sowing.sowing_ok
  const accentColor = ok ? COLORS.online : COLORS.muted
  const progress = Math.min(100, (sowing.accumulated_rain_mm / sowing.threshold_mm) * 100)

  return (
    <div className="rounded-md border border-line bg-panel-2/60 px-3 py-2.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted">
          SOWING WINDOW
        </span>
        <span
          className="font-mono text-[10px] tracking-[0.1em]"
          style={{ color: accentColor }}
        >
          {ok ? `ONSET +${sowing.onset_lead_day}d` : 'NOT YET'}
        </span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full"
          style={{ width: `${progress}%`, background: accentColor }}
        />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9px] text-muted">
        <span>{sowing.accumulated_rain_mm} mm acc.</span>
        <span>threshold {sowing.threshold_mm} mm</span>
      </div>
    </div>
  )
}
