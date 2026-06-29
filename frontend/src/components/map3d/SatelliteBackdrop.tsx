// SatelliteBackdrop.tsx — a subtle "from orbit" ambience for the INSAT-3D 3D terrain.
// Drop-in r3f primitive set (NOT a Canvas): a dim procedural starfield on a large back
// sphere plus a faint atmospheric glow ring, evoking a satellite view of the surface.
//
// No external assets, no scene lights: stars are a THREE.Points with a basic PointsMaterial
// and the glow is an additive transparent mesh — consistent with Terrain3D's unlit approach
// (meshBasicMaterial + baked colour). Geometry/material are built in useMemo so they are
// created once and disposed cleanly when the component unmounts.

import { useMemo, useEffect } from 'react'
import * as THREE from 'three'

interface Props {
  /** number of stars (default 600) */
  count?: number
  /** radius of the star sphere; keep < camera far (100) but well beyond the terrain */
  radius?: number
  /** whether to render the faint atmospheric glow ring (default true) */
  glow?: boolean
}

// Deterministic pseudo-random (mulberry32) so the starfield is stable across HMR/renders
// instead of jittering with Math.random on every remount.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export default function SatelliteBackdrop({ count = 600, radius = 60, glow = true }: Props) {
  // Starfield points: positions on a sphere shell, dim cool-white colours per vertex.
  const stars = useMemo(() => {
    const rand = mulberry32(0x5a7e21)
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const col = new THREE.Color()
    for (let i = 0; i < count; i++) {
      // uniform direction on the unit sphere
      const u = rand() * 2 - 1 // cos(theta)
      const phi = rand() * Math.PI * 2
      const s = Math.sqrt(1 - u * u)
      const r = radius * (0.92 + rand() * 0.08) // slight depth scatter
      positions[i * 3] = r * s * Math.cos(phi)
      positions[i * 3 + 1] = r * s * Math.sin(phi)
      positions[i * 3 + 2] = r * u
      // dim, faintly blue-white; a few warmer to add subtle variety
      const b = 0.25 + rand() * 0.45
      col.setRGB(b * 0.85, b * 0.9, b)
      colors[i * 3] = col.r
      colors[i * 3 + 1] = col.g
      colors[i * 3 + 2] = col.b
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return g
  }, [count, radius])

  // Faint atmospheric glow: a large back-facing sphere shell tinted cool blue, additive
  // and very low opacity so it reads as a thin halo of atmosphere, never overpowering.
  const glowGeo = useMemo(() => new THREE.SphereGeometry(radius * 0.97, 48, 32), [radius])

  // Dispose GPU resources on unmount (useMemo only memoises, it does not free).
  useEffect(() => () => stars.dispose(), [stars])
  useEffect(() => () => glowGeo.dispose(), [glowGeo])

  return (
    <group>
      <points geometry={stars}>
        <pointsMaterial
          vertexColors
          size={0.18}
          sizeAttenuation
          transparent
          opacity={0.7}
          depthWrite={false}
        />
      </points>
      {glow && (
        <mesh geometry={glowGeo}>
          <meshBasicMaterial
            color="#1b3a66"
            side={THREE.BackSide}
            transparent
            opacity={0.12}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  )
}
