// useTwinStream.ts — drive the Twin view from the simulated real-time WebSocket.
// Opens /ws/twin and accumulates ticks into a TwinRunResp-shaped object so the existing
// Twin UI renders days as they arrive live (clock advances, TwinCore flares per tick).
// Offline-safe: the backend replays the cached cube, it is NOT a live download.

import { useEffect, useRef, useState } from 'react'
import { openTwinStream, type TwinStreamOpts, type TwinTick } from '../api/client'
import type { TwinDay, TwinRunResp } from '../api/types'

export interface TwinStreamState {
  run: TwinRunResp | null
  streaming: boolean
  latestLead: number
  done: boolean
  error: string | null
}

const IDLE: TwinStreamState = { run: null, streaming: false, latestLead: 0, done: false, error: null }

export function useTwinStream(opts: TwinStreamOpts, enabled: boolean): TwinStreamState {
  const [state, setState] = useState<TwinStreamState>(IDLE)
  const closeRef = useRef<null | (() => void)>(null)

  useEffect(() => {
    if (!enabled || !opts.model) {
      setState(IDLE)
      return
    }
    setState({ ...IDLE, streaming: true })
    const close = openTwinStream(opts, (m: TwinTick) => {
      if (m.type === 'init') {
        setState((s) => ({
          ...s,
          streaming: true,
          run: {
            anchor_date: m.anchor_date ?? '',
            model: m.model ?? '',
            horizon: m.horizon ?? 0,
            assimilate: m.assimilate ?? false,
            data_source: '',
            lat: m.lat ?? [],
            lon: m.lon ?? [],
            units: m.units ?? {},
            sync_ref_tmax_c: 6,
            days: [],
          },
        }))
      } else if (m.type === 'tick') {
        const day = {
          lead_day: m.lead_day ?? 0,
          date: m.date ?? '',
          twin: m.twin ?? {},
          impacts_twin: m.impacts_twin,
          reality: m.reality ?? null,
          divergence: m.divergence ?? null,
          sync_pct: m.sync_pct ?? null,
          impacts_reality: m.impacts_reality,
        } as unknown as TwinDay
        setState((s) =>
          s.run
            ? { ...s, run: { ...s.run, days: [...s.run.days, day] }, latestLead: m.lead_day ?? s.latestLead }
            : s,
        )
      } else if (m.type === 'done') {
        setState((s) => ({ ...s, streaming: false, done: true }))
      } else if (m.type === 'error') {
        setState((s) => ({ ...s, streaming: false, error: m.message ?? 'stream error' }))
      }
    })
    closeRef.current = close
    return () => {
      close()
      closeRef.current = null
    }
    // primitive deps so we don't reconnect on every render (opts is a fresh object each time)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, opts.date, opts.horizon, opts.assimilate, opts.model, opts.intervalMs])

  return state
}
