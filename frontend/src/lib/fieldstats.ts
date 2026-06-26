// fieldstats.ts — light client-side field statistics for the Downscale analysis panels.
// Everything here is a deterministic function of fields the API already returned — no new
// numbers invented, consistent with the project's honesty rules.

/** Mean absolute spatial gradient = fine-scale "texture" energy of a 2-D field. */
export function gradientEnergy(field: number[][]): number {
  let s = 0
  let n = 0
  for (let i = 0; i < field.length; i++) {
    for (let j = 0; j < field[i].length; j++) {
      if (i + 1 < field.length) {
        s += Math.abs(field[i + 1][j] - field[i][j])
        n++
      }
      if (j + 1 < field[i].length) {
        s += Math.abs(field[i][j + 1] - field[i][j])
        n++
      }
    }
  }
  return n ? s / n : 0
}

/** Per-day spatial standard deviation (variability). */
export function spatialStd(field: number[][]): number {
  const xs: number[] = []
  for (const row of field) for (const x of row) xs.push(x)
  const m = xs.reduce((a, b) => a + b, 0) / (xs.length || 1)
  const v = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length || 1)
  return Math.sqrt(v)
}

/** Histogram of a field's values into `bins` buckets over [0, max]. Returns counts (fraction). */
export function histogram(field: number[][], bins: number, max: number): number[] {
  const counts = new Array(bins).fill(0)
  let total = 0
  for (const row of field) {
    for (const x of row) {
      const k = Math.min(bins - 1, Math.max(0, Math.floor((x / (max || 1)) * bins)))
      counts[k]++
      total++
    }
  }
  return counts.map((c) => (total ? c / total : 0))
}

/** Radially-averaged power spectrum (naive 2-D DFT — fine for these tiny grids).
 *  Returns power per radial wavenumber bin (index 1..) — higher index = finer detail. */
export function radialSpectrum(field: number[][]): number[] {
  const H = field.length
  const W = field[0]?.length ?? 0
  if (!H || !W) return []
  // de-mean
  let mean = 0
  for (const row of field) for (const x of row) mean += x
  mean /= H * W
  // 2-D DFT magnitude² at each (ky,kx), then radial-average
  const cy = H / 2
  const cx = W / 2
  const nbin = Math.floor(Math.min(cy, cx))
  const acc = new Array(nbin).fill(0)
  const cnt = new Array(nbin).fill(0)
  for (let ky = 0; ky < H; ky++) {
    for (let kx = 0; kx < W; kx++) {
      let re = 0
      let im = 0
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const ang = -2 * Math.PI * ((ky * y) / H + (kx * x) / W)
          const v = field[y][x] - mean
          re += v * Math.cos(ang)
          im += v * Math.sin(ang)
        }
      }
      const power = re * re + im * im
      // radial distance from DC (with wrap to [-H/2,H/2])
      const dy = ky > cy ? ky - H : ky
      const dx = kx > cx ? kx - W : kx
      const r = Math.round(Math.hypot(dy, dx))
      if (r >= 1 && r <= nbin) {
        acc[r - 1] += power
        cnt[r - 1]++
      }
    }
  }
  return acc.map((a, i) => (cnt[i] ? a / cnt[i] : 0))
}
