// lib/format.ts — number / unit / date formatting + clock helpers. No web storage.

/** Format a number to a fixed precision, trimming to a compact string. */
export function fmt(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  return n.toFixed(digits)
}

/** Percentage from a 0..1 fraction. */
export function pct(frac: number | null | undefined, digits = 0): string {
  if (frac === null || frac === undefined || Number.isNaN(frac)) return '—'
  return `${(frac * 100).toFixed(digits)}%`
}

/** Wall-clock string for a timezone, HH:MM:SS. */
export function clockIn(tz: string, d: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d)
}

/** YYYY-MM-DD -> "31 Dec 2023". */
export function prettyDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d)
}

/** ease-out cubic for count-up animations. */
export function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3)
}

/** Grid mean ignoring NaN; small helper for deriving headline numbers from fields. */
export function gridMean(grid: number[][]): number {
  let sum = 0
  let n = 0
  for (const row of grid) {
    for (const v of row) {
      if (!Number.isNaN(v)) {
        sum += v
        n += 1
      }
    }
  }
  return n ? sum / n : 0
}
