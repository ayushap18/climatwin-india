// TimeSlider.tsx — scrub from past observations through NOW into the forecast. A range
// input drives the active frame; a NOW divider marks the observed→forecast boundary; the
// forecast span is tinted saffron. Play/pause animates the scrub via the hook's interval.

import type { Frame } from '../../state/useTimeline'
import { prettyDate } from '../../lib/format'

interface Props {
  frames: Frame[]
  index: number
  nowIndex: number
  playing: boolean
  onScrub: (i: number) => void
  onTogglePlay: () => void
}

export default function TimeSlider({
  frames,
  index,
  nowIndex,
  playing,
  onScrub,
  onTogglePlay,
}: Props) {
  if (frames.length === 0) return null
  const max = frames.length - 1
  const active = frames[index]
  const nowPct = max > 0 ? (nowIndex / max) * 100 : 0
  const forecast = active?.kind === 'forecast'

  return (
    <div className="flex items-center gap-3 border-t border-line bg-panel/70 px-4 py-2.5 backdrop-blur-sm">
      <button
        onClick={onTogglePlay}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-isro/40 bg-panel-2 text-saffron transition-colors hover:border-saffron/60"
        aria-label={playing ? 'pause' : 'play'}
      >
        {playing ? '❚❚' : '▶'}
      </button>

      <div className="relative flex-1">
        {/* tinted past/forecast track */}
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full">
          <div className="absolute inset-y-0 left-0 bg-isro/30" style={{ width: `${nowPct}%` }} />
          <div
            className="absolute inset-y-0 right-0 bg-saffron/30"
            style={{ width: `${100 - nowPct}%` }}
          />
        </div>
        {/* NOW divider */}
        <div
          className="pointer-events-none absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-online"
          style={{ left: `${nowPct}%`, boxShadow: '0 0 6px #36d399' }}
        />
        <input
          type="range"
          min={0}
          max={max}
          value={index}
          onChange={(e) => onScrub(Number(e.target.value))}
          className="ct-range relative w-full"
          style={{ accentColor: forecast ? '#ff8a3d' : '#2b6cff' }}
        />
      </div>

      <div className="w-40 shrink-0 text-right font-mono text-[11px]">
        <span className={forecast ? 'text-saffron' : active?.kind === 'now' ? 'text-online' : 'text-ink'}>
          {active ? prettyDate(active.date) : '—'}
        </span>
        <div className="text-[9px] tracking-[0.15em] text-muted">
          {active?.kind === 'now' ? 'OBSERVED · NOW' : forecast ? `FORECAST · ${active.label}` : `OBSERVED · ${active?.label}`}
        </div>
      </div>
    </div>
  )
}
