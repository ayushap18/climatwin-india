// api/client.ts — the single fetch wrapper. Three responsibilities:
//   (a) prepend VITE_API_BASE so callers use bare paths ('/state', '/meta');
//   (b) measure request latency into a module field the TopBar polls;
//   (c) emit a twin-stage event on a tiny pub/sub bus so the TwinCore node for the
//       active digital-twin stage flares while the request is in flight.

export type TwinStage = 'MIRROR' | 'ASSIMILATE' | 'SIMULATE' | 'PERTURB' | 'IMPACT'

const API_BASE = import.meta.env.VITE_API_BASE ?? '/api'

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
    const res = await fetch(`${API_BASE}${path}`, {
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
