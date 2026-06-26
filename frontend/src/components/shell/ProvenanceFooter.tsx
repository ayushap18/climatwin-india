// ProvenanceFooter.tsx — honest data-provenance line. Source, model, date range, grid.
// Lives in the bottom-right panel of the layout. Reads straight from meta.

import { useAppState } from '../../state/useAppState'
import { prettyDate } from '../../lib/format'

export default function ProvenanceFooter() {
  const { meta, model } = useAppState()
  if (!meta) return null

  const grid = `${meta.grid.shape[0]}×${meta.grid.shape[1]} @ ${meta.res_deg}°`
  const range = `${prettyDate(meta.dates.start)} – ${prettyDate(meta.dates.end)}`

  return (
    <div className="flex h-full flex-col justify-center gap-1.5 px-4 py-3 font-mono text-[10px] text-muted">
      <Row k="DATA" v={`${meta.data_source.toUpperCase()}${meta.lst_source ? ` · LST ${meta.lst_source}` : ''}`} />
      <Row k="MODEL" v={`${(model ?? meta.default_model).toUpperCase()}  (of ${meta.models.length})`} />
      <Row k="RANGE" v={range} />
      <Row k="GRID" v={grid} />
      {meta.data_source_note && (
        <div className="mt-1 border-t border-line pt-1.5 text-[9px] leading-snug text-muted/70">
          {meta.data_source_note}
        </div>
      )}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[8px] tracking-[0.2em] text-muted/60">{k}</span>
      <span className="text-right text-ink/90">{v}</span>
    </div>
  )
}
