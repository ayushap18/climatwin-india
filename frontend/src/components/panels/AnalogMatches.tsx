// AnalogMatches.tsx — the analog model's explanation. When the analog (k-NN) forecaster
// is active, it shows the most-similar past IMD days whose observed futures were averaged
// into this forecast. This is the "next week behaves like 16 Jul 2016" demo moment — a
// forecast you can audit against the national archive, not a black box.

import type { AnalogMatch } from '../../api/types'

function pretty(d: string): string {
  // d is YYYY-MM-DD
  const [y, m, day] = d.split('-')
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${day} ${mon[Number(m) - 1] ?? m} ${y}`
}

export default function AnalogMatches({ analogs }: { analogs: AnalogMatch[] }) {
  if (!analogs?.length) return null
  const top = analogs.slice(0, 6)
  return (
    <div className="rounded-md border border-isro/30 bg-isro/5 px-2.5 py-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="font-mono text-[10px] tracking-[0.14em] text-isro">ANALOG MATCHES</span>
        <span className="font-mono text-[8px] text-muted/70">most-similar IMD days</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {top.map((a) => (
          <span
            key={a.date}
            title={`similarity distance ${a.distance.toFixed(2)}`}
            className="rounded border border-line bg-panel-2/60 px-1.5 py-0.5 font-mono text-[9px] text-ink/90"
          >
            {pretty(a.date)}
          </span>
        ))}
      </div>
      <p className="mt-1.5 font-mono text-[8px] leading-snug text-muted/70">
        forecast = average of what actually happened after these days (train years only — no leakage)
      </p>
    </div>
  )
}
