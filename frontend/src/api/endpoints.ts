// api/endpoints.ts — typed wrappers over apiFetch, each tagged with its twin stage
// and memoized through the module-level cache. Bare paths; the client prepends the base.

import { apiFetch, twinBus } from './client'
import { cacheGet, cacheKey, cacheSet } from './cache'
import type {
  DownscaleResp,
  ForecastResp,
  Health,
  Meta,
  StateResp,
  TwinRunResp,
  ValidateResp,
  WhatIfParams,
  WhatIfResp,
} from './types'

export async function getHealth(): Promise<Health> {
  const key = cacheKey('/health')
  const hit = cacheGet<Health>(key)
  if (hit) return hit
  return cacheSet(key, await apiFetch<Health>('/health'))
}

export async function getMeta(): Promise<Meta> {
  const key = cacheKey('/meta')
  const hit = cacheGet<Meta>(key)
  if (hit) return hit
  return cacheSet(key, await apiFetch<Meta>('/meta'))
}

export async function getState(date?: string): Promise<StateResp> {
  const key = cacheKey('/state', { date })
  const hit = cacheGet<StateResp>(key)
  if (hit) return hit
  const path = date ? `/state?date=${encodeURIComponent(date)}` : '/state'
  return cacheSet(key, await apiFetch<StateResp>(path, { stage: 'MIRROR' }))
}

export interface ForecastQuery {
  date?: string
  horizon?: number
  model?: string
  uncertainty?: boolean
}

export async function getForecast(q: ForecastQuery = {}): Promise<ForecastResp> {
  const key = cacheKey('/forecast', { ...q })
  const hit = cacheGet<ForecastResp>(key)
  if (hit) return hit
  const params = new URLSearchParams()
  if (q.date) params.set('date', q.date)
  if (q.horizon != null) params.set('horizon', String(q.horizon))
  if (q.model) params.set('model', q.model)
  if (q.uncertainty) params.set('uncertainty', 'true')
  const qs = params.toString()
  const path = qs ? `/forecast?${qs}` : '/forecast'
  return cacheSet(key, await apiFetch<ForecastResp>(path, { stage: 'SIMULATE' }))
}

export async function postWhatIf(body: WhatIfParams): Promise<WhatIfResp> {
  const key = `/whatif:${JSON.stringify(body)}`
  const hit = cacheGet<WhatIfResp>(key)
  if (hit) return hit
  // flare the twin loop in its scenario order: PERTURB -> SIMULATE -> IMPACT
  twinBus.emit('PERTURB')
  window.setTimeout(() => twinBus.emit('SIMULATE'), 220)
  window.setTimeout(() => twinBus.emit('IMPACT'), 440)
  return cacheSet(key, await apiFetch<WhatIfResp>('/whatif', { method: 'POST', body }))
}

export interface TwinQuery {
  date?: string
  horizon?: number
  assimilate?: boolean
  model?: string
}

export async function getTwinRun(q: TwinQuery = {}): Promise<TwinRunResp> {
  const key = cacheKey('/twin/run', { ...q })
  const hit = cacheGet<TwinRunResp>(key)
  if (hit) return hit
  const params = new URLSearchParams()
  if (q.date) params.set('date', q.date)
  if (q.horizon != null) params.set('horizon', String(q.horizon))
  if (q.assimilate) params.set('assimilate', 'true')
  if (q.model) params.set('model', q.model)
  // flare the loop: MIRROR (anchor) -> [ASSIMILATE] -> SIMULATE (roll forward)
  twinBus.emit('MIRROR')
  if (q.assimilate) window.setTimeout(() => twinBus.emit('ASSIMILATE'), 200)
  window.setTimeout(() => twinBus.emit('SIMULATE'), q.assimilate ? 400 : 200)
  const qs = params.toString()
  return cacheSet(key, await apiFetch<TwinRunResp>(`/twin/run${qs ? `?${qs}` : ''}`))
}

export async function getValidate(): Promise<ValidateResp> {
  const key = cacheKey('/validate')
  const hit = cacheGet<ValidateResp>(key)
  if (hit) return hit
  return cacheSet(key, await apiFetch<ValidateResp>('/validate', { stage: 'IMPACT' }))
}

export async function getDownscale(date?: string, varName = 'rainfall'): Promise<DownscaleResp> {
  const key = cacheKey('/downscale', { date, var: varName })
  const hit = cacheGet<DownscaleResp>(key)
  if (hit) return hit
  const params = new URLSearchParams({ var: varName })
  if (date) params.set('date', date)
  return cacheSet(key, await apiFetch<DownscaleResp>(`/downscale?${params.toString()}`))
}
