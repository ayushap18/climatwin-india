// lib/colormaps.ts — map a physical value to a color for a given variable, using the
// per-variable stops in theme.ts and the data range from meta.colorbar_ranges.

import { COLORMAPS, sampleColormap } from '../theme'
import type { VarName } from '../api/types'

/** Normalize `value` into [0,1] across [lo,hi] (clamped). */
export function normalize(value: number, lo: number, hi: number): number {
  if (hi <= lo) return 0
  return Math.max(0, Math.min(1, (value - lo) / (hi - lo)))
}

/** Color for a variable value given its [lo,hi] colorbar range. */
export function colorForValue(
  variable: VarName,
  value: number,
  range: [number, number],
): string {
  const stops = COLORMAPS[variable] ?? COLORMAPS.tmax
  return sampleColormap(stops, normalize(value, range[0], range[1]))
}

/** CSS linear-gradient string for a variable's colorbar (left=lo, right=hi). */
export function gradientCss(variable: VarName): string {
  const stops = COLORMAPS[variable] ?? COLORMAPS.tmax
  const parts = stops.map(([pos, hex]) => `${hex} ${Math.round(pos * 100)}%`)
  return `linear-gradient(90deg, ${parts.join(', ')})`
}
