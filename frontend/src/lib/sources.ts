// lib/sources.ts — the honest data-source regime model for the top-bar SOURCE switcher.
//
// There is ONE cube + ONE validated model (IMD national data, 2000-2023, with a
// synthetic LST channel). "Switching source" is therefore a DATA REGIME + provenance
// choice, not a swap to a different trained model — we never fake a second pipeline:
//   • synthetic  → the validated regime, full 2000-2023 record.
//   • insat_real → the indigenous-satellite regime, clamped to the INSAT-3D era
//                  (2015-2023, which also respects the model's 2023 training cutoff).
//                  It is "active" only once the backend actually serves real LST
//                  (meta.lst_source === 'insat_real' after a retrain); until then it
//                  is "pending": selectable + honestly labelled, same validated model
//                  underneath, date range clamped to the satellite era.

import { useEffect, useMemo } from 'react'
import { useAppState } from '../state/useAppState'
import type { Meta } from '../api/types'

// INSAT-3D archive LST is dependable from ~2015 onward (3D launched mid-2013).
export const INSAT_ERA_START = '2015-01-01'

export type SourceStatus = 'active' | 'pending'

export interface DataSource {
  key: string
  label: string // top-bar label
  lstLabel: string // LST provenance tag
  dateStart: string // YYYY-MM-DD — regime floor
  dateEnd: string // YYYY-MM-DD — regime ceiling (training cutoff)
  featured: string // a curated active day to land on within the regime
  status: SourceStatus
  note: string // honest one-liner shown on hover / banner
}

function lstLabel(lst: string | null): string {
  if (lst && lst.toLowerCase().includes('insat')) return 'INSAT-3D'
  return 'SYNTHETIC'
}

export function deriveSources(meta: Meta): DataSource[] {
  // Prefer the backend's authoritative per-regime metadata (real dates/status/note).
  if (meta.sources && meta.sources.length) {
    return meta.sources.map((s) => ({
      key: s.key,
      label: s.label,
      lstLabel: lstLabel(s.lst_source),
      dateStart: s.dates.start,
      dateEnd: s.dates.end,
      featured: s.featured_date,
      status: s.status,
      note: s.note,
    }))
  }
  // Fallback for an older backend without sources[]: single validated regime.
  return [{
    key: 'synthetic',
    label: 'IMD · Synthetic LST',
    lstLabel: 'SYNTHETIC',
    dateStart: meta.dates.start,
    dateEnd: meta.dates.end,
    featured: meta.latest_date,
    status: 'active',
    note: `Validated regime — full ${meta.dates.start.slice(0, 4)}–${meta.dates.end.slice(0, 4)} record.`,
  }]
}

export function activeSourceKey(meta: Meta): string {
  // The backend default regime is synthetic; the switcher overrides per user choice.
  const first = meta.sources?.[0]?.key
  return first ?? 'synthetic'
}

function clampDate(d: string, lo: string, hi: string): string {
  return d < lo ? lo : d > hi ? hi : d
}

/** The currently-selected source + its date bounds, plus a clamp helper for date pickers. */
export function useActiveSource(): {
  source: DataSource | null
  sources: DataSource[]
  clamp: (d: string | undefined) => string | undefined
} {
  const { meta, source } = useAppState()
  return useMemo(() => {
    if (!meta) return { source: null, sources: [], clamp: (d) => d }
    const sources = deriveSources(meta)
    const key = source ?? activeSourceKey(meta)
    const active = sources.find((s) => s.key === key) ?? sources[0]
    const clamp = (d: string | undefined) =>
      d == null ? d : clampDate(d, active.dateStart, active.dateEnd)
    return { source: active, sources, clamp }
  }, [meta, source])
}

/**
 * Snap a view's anchor date into the active source window when (and only when) the
 * regime changes. A falsy/undefined date means "use latest", so we never snap on the
 * initial synthetic mount; on switching to a regime that excludes the current date we
 * jump to the most recent in-window day (true latest, else the window end).
 */
export function useSnapDateToSource(
  date: string | undefined,
  set: (d: string) => void,
  latest?: string,
): void {
  const { meta, source } = useAppState()
  const key = source ?? (meta ? activeSourceKey(meta) : null)
  useEffect(() => {
    if (!meta || !key) return
    const active = deriveSources(meta).find((s) => s.key === key)
    if (!active) return
    const eff = date || latest || meta.latest_date
    if (eff < active.dateStart || eff > active.dateEnd) {
      // land on the regime's curated active day (e.g. a 2020 monsoon day), not the
      // dead end-of-record; fall back to true-latest then the window end.
      const recent = meta.true_latest_date || meta.latest_date
      const inRange = (d: string) => d >= active.dateStart && d <= active.dateEnd
      set(inRange(active.featured) ? active.featured : inRange(recent) ? recent : active.dateEnd)
    }
    // Intentionally regime-keyed only: snap on source change, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}
