// SmoothField.tsx — render a coarse 2D field as a smooth, photographic/satellite-style image.
//
// A plain SVG <Grid> of rects reads as a blocky heatmap. For the fine downscaled fields
// (40×60 · ~5.5 km/cell) we instead interpolate the VALUES bilinearly onto a super-sampled
// pixel canvas and only then apply the (perceptual) colormap, so the result is a continuous,
// satellite-like picture rather than visible cells. Interpolating in value-space (not in
// color-space) avoids the banding you get when a browser blurs already-colored pixels through
// a non-linear palette. A final CSS `imageRendering:'auto'` lets the browser add one more pass
// of bilinear smoothing on display.
//
// Orientation matches <Grid>: field row 0 is drawn at the BOTTOM (south), so the canvas is
// flipped vertically. Non-finite cells (masked ocean / NaN) render transparent and never bleed
// into their finite neighbours (weights are renormalised over the finite corners only).

import { useEffect, useRef } from 'react'

interface SmoothFieldProps {
  field: number[][]
  /** value -> CSS color; must return the `rgb(R, G, B)` form produced by sampleColormap. */
  colorFn: (value: number) => string
  /** displayed width in px (height derives from the field aspect ratio). */
  width: number
  /** super-sampling factor for the value interpolation (default 6). */
  scale?: number
}

/** Bilinear sample of `field` at fractional (frow, fcol), ignoring non-finite corners. */
function sample(field: number[][], rows: number, cols: number, frow: number, fcol: number): number {
  const x0 = Math.floor(fcol)
  const y0 = Math.floor(frow)
  const x1 = Math.min(cols - 1, x0 + 1)
  const y1 = Math.min(rows - 1, y0 + 1)
  const tx = fcol - x0
  const ty = frow - y0
  const corners: Array<[number, number]> = [
    [field[y0][x0], (1 - tx) * (1 - ty)],
    [field[y0][x1], tx * (1 - ty)],
    [field[y1][x0], (1 - tx) * ty],
    [field[y1][x1], tx * ty],
  ]
  let acc = 0
  let wsum = 0
  for (const [v, w] of corners) {
    if (Number.isFinite(v) && w > 0) {
      acc += v * w
      wsum += w
    }
  }
  return wsum > 0 ? acc / wsum : NaN
}

export default function SmoothField({ field, colorFn, width, scale = 6 }: SmoothFieldProps) {
  const ref = useRef<HTMLCanvasElement>(null)
  const rows = field.length
  const cols = field[0]?.length ?? 1
  const displayH = (width / cols) * rows

  useEffect(() => {
    const cv = ref.current
    if (!cv || rows < 1 || cols < 1) return
    const tw = Math.max(1, cols * scale)
    const th = Math.max(1, rows * scale)
    cv.width = tw
    cv.height = th
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const img = ctx.createImageData(tw, th)
    for (let py = 0; py < th; py++) {
      // canvas y=0 is the top (north); field row 0 is the bottom (south) -> flip.
      const frow = th > 1 ? (rows - 1) * (1 - py / (th - 1)) : 0
      for (let px = 0; px < tw; px++) {
        const fcol = tw > 1 ? (cols - 1) * (px / (tw - 1)) : 0
        const v = sample(field, rows, cols, frow, fcol)
        const p = (py * tw + px) * 4
        if (!Number.isFinite(v)) {
          img.data[p + 3] = 0
          continue
        }
        const m = colorFn(v).match(/\d+/g)
        img.data[p] = m ? +m[0] : 0
        img.data[p + 1] = m ? +m[1] : 0
        img.data[p + 2] = m ? +m[2] : 0
        img.data[p + 3] = 255
      }
    }
    ctx.putImageData(img, 0, 0)
  }, [field, colorFn, rows, cols, scale])

  return (
    <canvas
      ref={ref}
      style={{ width, height: displayH, imageRendering: 'auto', display: 'block' }}
    />
  )
}
