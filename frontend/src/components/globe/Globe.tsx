// Globe.tsx — an always-spinning WebGL Earth (cobe), offline (no tiles, no network).
// India is tinted saffron via a marker cluster around the subcontinent, with a bright
// Delhi-NCR pin. Purely decorative "mission control" ambience for the Overview hero.

import { useEffect, useRef } from 'react'
import createGlobe from 'cobe'
import { useAppState } from '../../state/useAppState'

// Delhi-NCR center (lat, lon) from config.PILOT midpoint.
const DELHI: [number, number] = [28.6, 77.0]

// A scatter of markers across India to read as a saffron landmass glow.
const INDIA_MARKERS: Array<{ location: [number, number]; size: number }> = [
  { location: DELHI, size: 0.09 },
  { location: [19.07, 72.87], size: 0.05 }, // Mumbai
  { location: [13.08, 80.27], size: 0.05 }, // Chennai
  { location: [22.57, 88.36], size: 0.05 }, // Kolkata
  { location: [12.97, 77.59], size: 0.05 }, // Bengaluru
  { location: [26.85, 80.95], size: 0.04 }, // Lucknow
  { location: [23.03, 72.58], size: 0.04 }, // Ahmedabad
  { location: [17.38, 78.48], size: 0.04 }, // Hyderabad
  { location: [21.15, 79.09], size: 0.04 }, // Nagpur
  { location: [30.73, 76.78], size: 0.04 }, // Chandigarh
]

export default function Globe({ size = 360 }: { size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { globeSpin } = useAppState()
  const spinRef = useRef(globeSpin)
  useEffect(() => {
    spinRef.current = globeSpin
  }, [globeSpin])

  useEffect(() => {
    let phi = 4.9 // start roughly facing India
    let width = 0
    const canvas = canvasRef.current
    if (!canvas) return

    const onResize = () => {
      width = canvas.offsetWidth
    }
    onResize()
    window.addEventListener('resize', onResize)

    const globe = createGlobe(canvas, {
      devicePixelRatio: 2,
      width: width * 2,
      height: width * 2,
      phi: 0,
      theta: 0.28,
      dark: 1,
      diffuse: 1.3,
      mapSamples: 16000,
      mapBrightness: 7,
      baseColor: [0.2, 0.28, 0.45],
      markerColor: [1, 0.54, 0.24], // saffron
      glowColor: [0.2, 0.45, 1], // isro blue
      markers: INDIA_MARKERS,
      onRender: (state) => {
        state.phi = phi
        if (spinRef.current) phi += 0.0035 // pause rotation when globe spin is off
        state.width = width * 2
        state.height = width * 2
      },
    })

    return () => {
      globe.destroy()
      window.removeEventListener('resize', onResize)
    }
  }, [])

  return (
    <div style={{ width: size, maxWidth: '100%', aspectRatio: '1' }} className="relative">
      {/* atmospheric glow so the planet reads even when WebGL is dim */}
      <div
        className="pointer-events-none absolute inset-0 rounded-full"
        style={{
          background:
            'radial-gradient(circle at 50% 50%, rgba(43,108,255,0.22) 38%, rgba(43,108,255,0.08) 55%, transparent 70%)',
          filter: 'blur(2px)',
        }}
      />
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', contain: 'layout paint size', position: 'relative' }}
      />
    </div>
  )
}
