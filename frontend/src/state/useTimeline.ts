// useTimeline.ts — builds the scrub timeline for the map/chart: a window of past observed
// days (/state), NOW (the latest observed date), and the forecast horizon (/forecast days).
// Also owns play/pause and refetches the forecast when model/horizon/uncertainty change.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getForecast, getState } from '../api/endpoints'
import type { Fields, Impacts, StateResp } from '../api/types'
import { useAppDispatch, useAppState } from './useAppState'
import { useActiveSource } from '../lib/sources'

const PAST_DAYS = 7
const PLAY_MS = 750

export type FrameKind = 'observed' | 'now' | 'forecast'
export interface Frame {
  key: string
  date: string // YYYY-MM-DD
  kind: FrameKind
  leadDay: number // <=0 observed/now, >0 forecast lead day
  label: string
}
export interface FrameData {
  fields: Fields
  impacts: Impacts
  std?: Fields
}

function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function useTimeline(anchor?: string) {
  const { meta, state, forecast, horizon, model, uncertainty } = useAppState()
  const { source: src } = useActiveSource()
  const dispatch = useAppDispatch()
  const init = anchor ?? meta?.latest_date ?? null
  // The earliest scrubable day respects the active source regime (e.g. INSAT era).
  const floor = src?.dateStart ?? meta?.dates.start

  const [observed, setObserved] = useState<Record<string, StateResp>>({})

  // refetch the forecast whenever its inputs change
  useEffect(() => {
    if (!init) return
    let on = true
    getForecast({ date: init, horizon, model: model ?? undefined, uncertainty })
      .then((f) => {
        // a read-only regime returns {pending:true} with no days — don't store it as frames
        if (on && !f.pending) dispatch({ type: 'SET_FORECAST', forecast: f })
      })
      .catch(() => {})
    return () => {
      on = false
    }
  }, [init, horizon, model, uncertainty, dispatch])

  // fetch the observed past window once per init date
  useEffect(() => {
    if (!init || !meta) return
    let on = true
    const start = floor ?? meta.dates.start
    const dates: string[] = []
    for (let k = PAST_DAYS; k >= 0; k--) {
      // include k=0 (the anchor itself) so the NOW frame has data for any chosen date
      const d = addDaysISO(init, -k)
      if (d >= start) dates.push(d)
    }
    Promise.all(dates.map((d) => getState(d).then((s) => [d, s] as const).catch(() => null))).then(
      (pairs) => {
        if (!on) return
        const map: Record<string, StateResp> = {}
        for (const p of pairs) if (p) map[p[0]] = p[1]
        setObserved(map)
      },
    )
    return () => {
      on = false
    }
  }, [init, meta, floor])

  const dataByDate = useMemo(() => {
    const m = new Map<string, FrameData>()
    for (const [d, s] of Object.entries(observed)) m.set(d, { fields: s.fields, impacts: s.impacts })
    if (state) m.set(state.date, { fields: state.fields, impacts: state.impacts })
    if (forecast)
      for (const day of forecast.days)
        m.set(day.date, { fields: day.fields, impacts: day.impacts, std: day.std })
    return m
  }, [observed, state, forecast])

  const frames = useMemo<Frame[]>(() => {
    if (!init) return []
    const fr: Frame[] = []
    const start = floor ?? meta?.dates.start ?? init
    for (let k = PAST_DAYS; k >= 1; k--) {
      const d = addDaysISO(init, -k)
      if (d >= start) fr.push({ key: d, date: d, kind: 'observed', leadDay: -k, label: `−${k}d` })
    }
    fr.push({ key: init, date: init, kind: 'now', leadDay: 0, label: 'NOW' })
    if (forecast)
      for (const day of forecast.days)
        fr.push({ key: day.date, date: day.date, kind: 'forecast', leadDay: day.lead_day, label: `+${day.lead_day}d` })
    return fr
  }, [init, meta, forecast, floor])

  const nowIndex = useMemo(() => frames.findIndex((f) => f.kind === 'now'), [frames])
  const framesLen = frames.length

  const [index, setIndex] = useState(0)
  const lastInitRef = useRef<string | null>(null)
  useEffect(() => {
    // (re)center on NOW the first time and whenever the anchor date changes
    if (nowIndex >= 0 && lastInitRef.current !== init) {
      setIndex(nowIndex)
      lastInitRef.current = init
    }
  }, [nowIndex, init])
  useEffect(() => {
    setIndex((i) => Math.min(Math.max(0, i), Math.max(0, framesLen - 1)))
  }, [framesLen])

  const [playing, setPlaying] = useState(false)
  const intRef = useRef<number | null>(null)
  useEffect(() => {
    if (!playing || framesLen === 0) return
    intRef.current = window.setInterval(() => {
      setIndex((i) => (i + 1) % framesLen)
    }, PLAY_MS)
    return () => {
      if (intRef.current) window.clearInterval(intRef.current)
    }
  }, [playing, framesLen])
  const togglePlay = useCallback(() => setPlaying((p) => !p), [])

  const activeFrame = frames[index] ?? null
  const activeData = activeFrame ? dataByDate.get(activeFrame.date) ?? null : null
  const getData = useCallback((f: Frame) => dataByDate.get(f.date) ?? null, [dataByDate])

  return { frames, index, setIndex, nowIndex, playing, togglePlay, activeFrame, activeData, getData }
}
