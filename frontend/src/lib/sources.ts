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
  status: SourceStatus
  note: string // honest one-liner shown on hover / banner
}

export function deriveSources(meta: Meta): DataSource[] {
  const realActive = meta.lst_source === 'insat_real'
  const insatStart = meta.dates.start > INSAT_ERA_START ? meta.dates.start : INSAT_ERA_START

  const synthetic: DataSource = {
    key: 'synthetic',
    label: 'IMD · Synthetic LST',
    lstLabel: 'SYNTHETIC',
    dateStart: meta.dates.start,
    dateEnd: meta.dates.end,
    status: 'active',
    note: `Validated regime — IMD national data with a synthetic LST channel over the full ${meta.dates.start.slice(0, 4)}–${meta.dates.end.slice(0, 4)} record.`,
  }

  const real: DataSource = {
    key: 'insat_real',
    label: 'IMD · INSAT-3D LST',
    lstLabel: 'INSAT-3D',
    dateStart: insatStart,
    dateEnd: meta.dates.end,
    status: realActive ? 'active' : 'pending',
    note: realActive
      ? `Real INSAT-3D LST fused and retrained — satellite era ${insatStart.slice(0, 4)}–${meta.dates.end.slice(0, 4)}.`
      : `INSAT-3D LST is observational and pending a retrain — the validated model still runs, clamped to the satellite era ${insatStart.slice(0, 4)}–${meta.dates.end.slice(0, 4)}.`,
  }

  return [synthetic, real]
}

export function activeSourceKey(meta: Meta): string {
  return meta.lst_source === 'insat_real' ? 'insat_real' : 'synthetic'
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
      const recent = meta.true_latest_date || meta.latest_date
      set(recent >= active.dateStart && recent <= active.dateEnd ? recent : active.dateEnd)
    }
    // Intentionally regime-keyed only: snap on source change, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
}
