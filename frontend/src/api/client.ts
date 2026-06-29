// api/client.ts — the single fetch wrapper. Three responsibilities:
//   (a) prepend VITE_API_BASE so callers use bare paths ('/state', '/meta');
//   (b) measure request latency into a module field the TopBar polls;
//   (c) emit a twin-stage event on a tiny pub/sub bus so the TwinCore node for the
//       active digital-twin stage flares while the request is in flight.

export type TwinStage = 'MIRROR' | 'ASSIMILATE' | 'SIMULATE' | 'PERTURB' | 'IMPACT'

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'

// --- active data-source regime, injected into every request ---------------------
// Default 'synthetic' is the validated regime; we omit the param for it so URLs stay
// clean and back-compatible. AppContext flips this (and clears the cache) on a switch.
let currentSource = 'synthetic'
export function setApiSource(s: string): void {
  currentSource = s || 'synthetic'
}
export function getApiSource(): string {
  return currentSource
}
function withSource(path: string): string {
  if (currentSource === 'synthetic') return path
  return `${path}${path.includes('?') ? '&' : '?'}source=${encodeURIComponent(currentSource)}`
}

// --- latency telemetry (module field; TopBar reads via getLastLatency) ---------
let lastLatencyMs = 0
export function getLastLatency(): number {
  return lastLatencyMs
}

// --- twin event bus (no deps; flares the TwinCore on every API call) -----------
type TwinListener = (stage: TwinStage) => void
const listeners = new Set<TwinListener>()

export const twinBus = {
  emit(stage: TwinStage) {
    for (const l of listeners) l(stage)
  },
  subscribe(fn: TwinListener): () => void {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}

// --- websocket: simulated real-time twin stream --------------------------------
// Same origin as the page; '/ws' is proxied to the backend in dev (vite.config.ts).
const WS_BASE =
  (import.meta.env.VITE_WS_BASE as string | undefined) ??
  (typeof window !== 'undefined'
    ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
    : '')

export interface TwinTick {
  type: 'init' | 'tick' | 'done' | 'error'
  // init
  anchor_date?: string
  region?: string
  model?: string
  assimilate?: boolean
  horizon?: number
  total_steps?: number
  lat?: number[]
  lon?: number[]
  units?: Record<string, string>
  // tick (shape matches TwinDay)
  lead_day?: number
  date?: string
  stage?: TwinStage
  twin?: Record<string, number[][]>
  reality?: Record<string, number[][]> | null
  divergence?: Record<string, number> | null
  sync_pct?: number | null
  impacts_twin?: unknown
  impacts_reality?: unknown
  // done / error
  steps?: number
  message?: string
}

export interface TwinStreamOpts {
  date?: string
  horizon?: number
  assimilate?: boolean
  model?: string
  intervalMs?: number
}

/**
 * Open the simulated-real-time twin WebSocket. Each tick flares its twin-loop stage on
 * the bus (so the TwinCore animates live) and is handed to `onMessage`. Returns a closer.
 */
export function openTwinStream(opts: TwinStreamOpts, onMessage: (m: TwinTick) => void): () => void {
  const p = new URLSearchParams()
  if (opts.date) p.set('date', opts.date)
  if (opts.horizon != null) p.set('horizon', String(opts.horizon))
  if (opts.assimilate != null) p.set('assimilate', String(opts.assimilate))
  if (opts.model) p.set('model', opts.model)
  if (opts.intervalMs != null) p.set('interval_ms', String(opts.intervalMs))
  if (currentSource !== 'synthetic') p.set('source', currentSource)
  let ws: WebSocket | null = null
  try {
    ws = new WebSocket(`${WS_BASE}/ws/twin?${p.toString()}`)
  } catch {
    onMessage({ type: 'error', message: 'websocket unavailable' })
    return () => {}
  }
  ws.onmessage = (ev) => {
    try {
      const m = JSON.parse(ev.data) as TwinTick
      if (m.stage) twinBus.emit(m.stage)
      onMessage(m)
    } catch {
      /* ignore malformed frame */
    }
  }
  ws.onerror = () => onMessage({ type: 'error', message: 'websocket error' })
  return () => {
    try {
      ws?.close()
    } catch {
      /* already closed */
    }
  }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

/**
 * Fetch `path` (bare, e.g. '/state?date=2023-07-01') against the API base.
 * `stage` flares the matching TwinCore node. Returns parsed JSON as T.
 */
export async function apiFetch<T>(
  path: string,
  opts: { stage?: TwinStage; method?: string; body?: unknown } = {},
): Promise<T> {
  const t0 = performance.now()
  if (opts.stage) twinBus.emit(opts.stage)
  try {
    const res = await fetch(`${API_BASE}${withSource(path)}`, {
      method: opts.method ?? 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    })
    if (!res.ok) {
      let detail = res.statusText
      try {
        const j = await res.json()
        detail = (j as { detail?: string }).detail ?? detail
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(res.status, detail)
    }
    return (await res.json()) as T
  } finally {
    lastLatencyMs = Math.round(performance.now() - t0)
  }
}
