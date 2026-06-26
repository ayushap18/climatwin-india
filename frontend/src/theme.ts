// theme.ts — single source of truth for the ISRO mission-control palette and the
// per-variable colormaps. Tailwind (tailwind.config.ts) mirrors the named colors so
// they're available both as JS tokens (here) and as utilities (bg-panel, text-saffron).

export const COLORS = {
  bg: '#05070d',
  panel: '#0b1020',
  panel2: '#0e1428',
  line: '#1b2742',
  isro: '#2b6cff',
  saffron: '#ff8a3d',
  ink: '#e8f0ff',
  muted: '#8aa0c8',
  online: '#36d399',
  danger: '#ff5470',
} as const

// Colormap stops per variable: ordered [position 0..1, hex]. Used now by StatCards
// for accent colors; reused by the map GridLayer/ColorBar in M2.
export type ColorStop = [number, string]

export const COLORMAPS: Record<string, ColorStop[]> = {
  // rainfall — blues
  rainfall: [
    [0.0, '#0a1530'],
    [0.35, '#1c4fb0'],
    [0.7, '#2b6cff'],
    [1.0, '#7fb2ff'],
  ],
  // tmax — amber -> saffron -> red
  tmax: [
    [0.0, '#1a2030'],
    [0.4, '#ffb347'],
    [0.75, '#ff8a3d'],
    [1.0, '#ff5470'],
  ],
  // tmin — cyan -> blue
  tmin: [
    [0.0, '#0a2230'],
    [0.5, '#27d3e6'],
    [1.0, '#2b6cff'],
  ],
  // diff — diverging blue <-> saffron, neutral at 0.5 (used by DiffLayer in M4)
  diff: [
    [0.0, '#2b6cff'],
    [0.5, '#0e1428'],
    [1.0, '#ff8a3d'],
  ],
}

/** Linear-interpolate a colormap at t in [0,1] -> "#rrggbb". */
export function sampleColormap(stops: ColorStop[], t: number): string {
  const x = Math.max(0, Math.min(1, t))
  let lo = stops[0]
  let hi = stops[stops.length - 1]
  for (let i = 0; i < stops.length - 1; i++) {
    if (x >= stops[i][0] && x <= stops[i + 1][0]) {
      lo = stops[i]
      hi = stops[i + 1]
      break
    }
  }
  const span = hi[0] - lo[0] || 1
  const f = (x - lo[0]) / span
  const c1 = hexToRgb(lo[1])
  const c2 = hexToRgb(hi[1])
  const r = Math.round(c1[0] + (c2[0] - c1[0]) * f)
  const g = Math.round(c1[1] + (c2[1] - c1[1]) * f)
  const b = Math.round(c1[2] + (c2[2] - c1[2]) * f)
  return `rgb(${r}, ${g}, ${b})`
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}
