// Terrain3D.tsx — the INSAT-3D regime's 3D map: the REAL CartoDEM extruded as terrain
// relief (Aravalli ridge high SW, Yamuna plains low E) with the selected variable (real
// INSAT LST / Tmax / Tmin / rainfall) draped as colour on the surface. Pure rendering of
// data we already have (DEM + the regime's 2020 fields) — no model, no fabricated values.
//
// Distinct from the synthetic regime's flat Leaflet heatmap. Built with react-three-fiber.
// The 9x13 grids are bilinearly upsampled onto a smooth subdivided mesh so the relief and
// the colour drape read crisply. Material is DoubleSide and the wrapper is absolutely
// positioned so the canvas always has size and the lit surface is never back-face culled.

import { useMemo, useState } from 'react'
import { Canvas, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { colorForValue, normalize } from '../../lib/colormaps'
import { sampleColormap, COLORMAPS } from '../../theme'
import type { LayerVar } from '../../api/types'
import SatelliteBackdrop from './SatelliteBackdrop'

interface Props {
  field: number[][] // selected variable, (H,W) raw units
  dem: number[][] // elevation, (H,W) metres
  variable: LayerVar
  range: [number, number] // colorbar range for the variable
  unit?: string
  contrast?: number
  onCellClick?: (row: number, col: number) => void
  selected?: { row: number; col: number } | null
}

// bilinear sample of a (H,W) grid at fractional (r in 0..H-1, c in 0..W-1)
function bilinear(grid: number[][], r: number, c: number): number {
  const H = grid.length
  const W = grid[0].length
  const r0 = Math.max(0, Math.min(H - 1, Math.floor(r)))
  const c0 = Math.max(0, Math.min(W - 1, Math.floor(c)))
  const r1 = Math.min(H - 1, r0 + 1)
  const c1 = Math.min(W - 1, c0 + 1)
  const fr = r - r0
  const fc = c - c0
  const a = grid[r0][c0]
  const b = grid[r0][c1]
  const cc = grid[r1][c0]
  const d = grid[r1][c1]
  return a * (1 - fr) * (1 - fc) + b * (1 - fr) * fc + cc * fr * (1 - fc) + d * fr * fc
}

const PLANE_W = 6 // world units (lon extent ~3deg)
const PLANE_H = 4 // world units (lat extent ~2deg)
const SEG_X = 130 // mesh subdivisions (smooth)
const SEG_Y = 88
const EXAGGERATION = 1.6 // vertical scale so ~340 m of real relief reads as terrain

function TerrainMesh({ field, dem, variable, range, contrast = 1, onCellClick }: Props) {
  const H = dem.length
  const W = dem[0].length

  const geometry = useMemo(() => {
    const g = new THREE.PlaneGeometry(PLANE_W, PLANE_H, SEG_X, SEG_Y)
    const pos = g.attributes.position as THREE.BufferAttribute
    const n = pos.count

    let dmin = Infinity
    let dmax = -Infinity
    for (const row of dem) for (const v of row) {
      if (Number.isFinite(v)) {
        if (v < dmin) dmin = v
        if (v > dmax) dmax = v
      }
    }
    if (!Number.isFinite(dmin) || dmax <= dmin) {
      dmin = 0
      dmax = 1
    }

    // Pass 1 (pre-rotation): displace height from the DEM and bake the data-drape colour
    // per vertex (using the still-unrotated x,y so the grid mapping is unambiguous).
    const base = new Float32Array(n * 3)
    const col = new THREE.Color()
    for (let i = 0; i < n; i++) {
      const u = (pos.getX(i) + PLANE_W / 2) / PLANE_W // 0..1 west->east
      const v = (pos.getY(i) + PLANE_H / 2) / PLANE_H // 0..1 south->north
      const gr = (1 - v) * (H - 1) // grid row 0 = north
      const gc = u * (W - 1)
      const elev = bilinear(dem, gr, gc)
      pos.setZ(i, Number.isFinite(elev) ? normalize(elev, dmin, dmax) * EXAGGERATION : 0)
      const val = bilinear(field, gr, gc)
      col.setStyle(colorForValue(variable, Number.isFinite(val) ? val : range[0], range, contrast))
      base[i * 3] = col.r
      base[i * 3 + 1] = col.g
      base[i * 3 + 2] = col.b
    }

    g.rotateX(-Math.PI / 2) // lay flat: displaced Z becomes height (+Y)
    g.computeVertexNormals()

    // Pass 2: bake hillshade (normal · sun) into the colour so relief reads with shaded
    // depth using a plain unlit material (reliable — no dependence on scene lighting).
    const nor = g.attributes.normal as THREE.BufferAttribute
    const sun = new THREE.Vector3(0.45, 0.82, 0.35).normalize()
    const colors = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const ndotl = Math.max(0, nor.getX(i) * sun.x + nor.getY(i) * sun.y + nor.getZ(i) * sun.z)
      const shade = 0.5 + 0.5 * ndotl
      colors[i * 3] = base[i * 3] * shade
      colors[i * 3 + 1] = base[i * 3 + 1] * shade
      colors[i * 3 + 2] = base[i * 3 + 2] * shade
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return g
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, dem, variable, range[0], range[1], contrast])

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    if (!onCellClick) return
    e.stopPropagation()
    const u = (e.point.x + PLANE_W / 2) / PLANE_W
    const v = (e.point.z + PLANE_H / 2) / PLANE_H // after rotation, world z is south->north
    const colIdx = Math.round(Math.max(0, Math.min(1, u)) * (W - 1))
    const rowIdx = Math.round(Math.max(0, Math.min(1, 1 - v)) * (H - 1))
    onCellClick(rowIdx, colIdx)
  }

  return (
    <mesh geometry={geometry} onClick={handleClick}>
      <meshBasicMaterial vertexColors side={THREE.DoubleSide} />
    </mesh>
  )
}

/** Vertical gradient legend for the active variable, drawn over the canvas. */
function Legend({ variable, range, unit }: { variable: LayerVar; range: [number, number]; unit?: string }) {
  const stops = COLORMAPS[variable] ?? COLORMAPS.tmax
  const gradient = `linear-gradient(to top, ${[0, 0.25, 0.5, 0.75, 1]
    .map((t) => sampleColormap(stops, t))
    .join(', ')})`
  return (
    <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-2">
      <div className="flex flex-col items-end font-mono text-[9px] text-muted">
        <span>{range[1].toFixed(variable === 'rainfall' ? 0 : 1)}</span>
        <span className="my-auto text-ink">{variable.toUpperCase()}{unit ? ` (${unit})` : ''}</span>
        <span>{range[0].toFixed(variable === 'rainfall' ? 0 : 1)}</span>
      </div>
      <div className="h-24 w-2 rounded-full border border-line" style={{ background: gradient }} />
    </div>
  )
}

export default function Terrain3D(props: Props) {
  const { field, dem, variable, range, unit, selected } = props
  const ready = !!field?.length && !!dem?.length
  const [orbiting, setOrbiting] = useState(false)

  const selValue =
    selected && Number.isFinite(field?.[selected.row]?.[selected.col])
      ? field[selected.row][selected.col]
      : null

  return (
    <div className="absolute inset-0">
      {ready ? (
        <Canvas
          dpr={[1, 2]}
          camera={{ position: [3.6, 4.4, 5.2], fov: 40, near: 0.1, far: 100 }}
          gl={{ antialias: true }}
          onPointerDown={() => setOrbiting(true)}
          onPointerUp={() => setOrbiting(false)}
        >
          <color attach="background" args={['#070b14']} />
          <SatelliteBackdrop />
          <TerrainMesh {...props} />
          <OrbitControls
            enablePan
            enableDamping
            dampingFactor={0.08}
            minDistance={3}
            maxDistance={14}
            maxPolarAngle={Math.PI / 2.02}
            target={[0, 0.5, 0]}
          />
        </Canvas>
      ) : (
        <div className="grid h-full w-full place-items-center font-mono text-[11px] text-muted">
          loading 3D terrain…
        </div>
      )}

      {ready && <Legend variable={variable} range={range} unit={unit} />}

      {selValue != null && selected && (
        <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-isro/40 bg-panel-2/90 px-2.5 py-1.5 font-mono text-[10px] text-ink backdrop-blur">
          cell [{selected.row},{selected.col}] · {variable}{' '}
          <span className="text-saffron">
            {selValue.toFixed(variable === 'rainfall' ? 1 : 1)}
            {unit ? ` ${unit}` : ''}
          </span>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-2 left-3 font-mono text-[9px] tracking-[0.12em] text-muted/80">
        3D · real CartoDEM relief ×{EXAGGERATION.toFixed(1)} · {orbiting ? 'orbiting' : 'drag to orbit · scroll to zoom'}
      </div>
    </div>
  )
}
