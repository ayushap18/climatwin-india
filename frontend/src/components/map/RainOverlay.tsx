// RainOverlay.tsx — a lightweight canvas rain effect over the map. Drop count + speed scale
// with the active rainfall intensity (0..1), so a wet field literally rains on the dashboard.
// pointer-events-none, so it never blocks map interaction. Hidden when there's little rain.

import { useEffect, useRef } from 'react'

export default function RainOverlay({ intensity }: { intensity: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const intRef = useRef(intensity)
  intRef.current = intensity

  useEffect(() => {
    const cv = ref.current
    const parent = cv?.parentElement
    if (!cv || !parent) return
    const ctx = cv.getContext('2d')
    if (!ctx) return

    let raf = 0
    let W = 0
    let H = 0
    const resize = () => {
      const r = parent.getBoundingClientRect()
      W = cv.width = Math.max(1, r.width)
      H = cv.height = Math.max(1, r.height)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(parent)

    const MAX = 280
    const drops = Array.from({ length: MAX }, () => ({
      x: Math.random() * 1200,
      y: Math.random() * 800,
      l: 5 + Math.random() * 9,
      v: 2.5 + Math.random() * 3.5,
    }))

    const draw = () => {
      ctx.clearRect(0, 0, W, H)
      const it = intRef.current
      const n = Math.round(20 + it * (MAX - 20))
      ctx.strokeStyle = 'rgba(120,170,255,0.32)'
      ctx.lineWidth = 1
      for (let i = 0; i < n; i++) {
        const d = drops[i]
        ctx.beginPath()
        ctx.moveTo(d.x, d.y)
        ctx.lineTo(d.x - 1.2, d.y + d.l * (0.7 + it))
        ctx.stroke()
        d.y += d.v * (0.8 + it)
        d.x -= 0.5
        if (d.y > H) {
          d.y = -d.l
          d.x = Math.random() * W
        }
        if (d.x < 0) d.x = W
      }
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  if (intensity <= 0.03) return null
  return <canvas ref={ref} className="ct-rain-canvas" />
}
