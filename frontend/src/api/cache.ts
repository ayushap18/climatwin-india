// api/cache.ts — module-level response cache. Deliberately NOT localStorage/
// sessionStorage (CLAUDE.md §10): a plain Map per process keeps the demo offline-safe
// and side-effect free. Survives view switches; cleared on full reload (which is fine —
// the bootstrap re-prefetches).

const store = new Map<string, unknown>()

export function cacheGet<T>(key: string): T | undefined {
  return store.get(key) as T | undefined
}

export function cacheSet<T>(key: string, value: T): T {
  store.set(key, value)
  return value
}

/** Drop everything — called when the data-source regime switches (cross-regime safety). */
export function cacheClear(): void {
  store.clear()
}

export function cacheKey(path: string, params?: Record<string, unknown>): string {
  if (!params) return path
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')
  return q ? `${path}?${q}` : path
}
