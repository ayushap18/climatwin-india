// RegionLocator.tsx — an honest coverage inset. The main map fits to the tiny pilot grid,
// which alone could read as "all of India". This little India silhouette with the pilot
// bbox marked makes coverage truthful at a glance: ONE pilot region, architecture scales
// to national. Reads the bbox/region straight from /meta so it follows config.PILOT.

import { useEffect, useState } from 'react'
import { loadIndiaAdm1, type IndiaFC } from '../../lib/geojson'
import { useThemeColors } from '../../lib/useThemeColors'
import { useAppState } from '../../state/useAppState'

// Fixed equirectangular frame over India (lon/lat), big enough to contain the mainland.
const LON0 = 67.5
const LON1 = 98.5
const LAT0 = 6.5
const LAT1 = 37.5
const W = 116
const H = 124

function px(lon: number): number {
  return ((lon - LON0) / (LON1 - LON0)) * W
}
function py(lat: number): number {
  return ((LAT1 - lat) / (LAT1 - LAT0)) * H // flip: north is up
}

function ringPath(coords: number[][]): string {
  return coords.map(([lon, lat], i) => `${i ? 'L' : 'M'}${px(lon).toFixed(1)} ${py(lat).toFixed(1)}`).join('') + 'Z'
}

function outlinePaths(fc: IndiaFC): string[] {
  const paths: string[] = []
  for (const f of fc.features) {
    const g = f.geometry
    if (g.type === 'Polygon') paths.push(ringPath(g.coordinates[0] as number[][]))
    else if (g.type === 'MultiPolygon')
      for (const poly of g.coordinates) paths.push(ringPath(poly[0] as number[][]))
  }
  return paths
}

export default function RegionLocator() {
  const { meta } = useAppState()
  const c = useThemeColors()
  const [paths, setPaths] = useState<string[] | null>(null)

  useEffect(() => {
    let on = true
    loadIndiaAdm1()
      .then((fc) => on && setPaths(outlinePaths(fc)))
      .catch(() => on && setPaths(null))
    return () => {
      on = false
    }
  }, [])

  if (!meta) return null
  const b = meta.bbox
  const x = px(b.lon_min)
  const y = py(b.lat_max)
  const w = Math.max(2.5, px(b.lon_max) - px(b.lon_min))
  const h = Math.max(2.5, py(b.lat_min) - py(b.lat_max))
  const cx = x + w / 2
  const cy = y + h / 2

  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-[500] rounded-lg border border-line bg-bg/80 px-2 pb-1.5 pt-1 backdrop-blur-sm">
      <div className="mb-0.5 font-mono text-[8px] tracking-[0.18em] text-muted">COVERAGE</div>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-label="pilot region within India">
        {paths?.map((d, i) => (
          <path key={i} d={d} fill={c.isro} fillOpacity={0.06} stroke={c.isro} strokeOpacity={0.5} strokeWidth={0.6} />
        ))}
        {/* pilot bbox */}
        <rect x={x} y={y} width={w} height={h} fill={c.saffron} fillOpacity={0.25} stroke={c.saffron} strokeWidth={1.1} />
        {/* locator crosshair so a tiny box is still findable */}
        <circle cx={cx} cy={cy} r={6.5} fill="none" stroke={c.saffron} strokeOpacity={0.7} strokeWidth={0.7} />
        <line x1={cx} y1={cy - 9} x2={cx} y2={cy + 9} stroke={c.saffron} strokeOpacity={0.6} strokeWidth={0.5} />
        <line x1={cx - 9} y1={cy} x2={cx + 9} y2={cy} stroke={c.saffron} strokeOpacity={0.6} strokeWidth={0.5} />
      </svg>
      <div className="mt-0.5 max-w-[116px] font-mono text-[7px] leading-tight text-muted/80">
        {meta.region} · {meta.grid.shape[0]}×{meta.grid.shape[1]} @ {meta.res_deg}° · scales to national
      </div>
    </div>
  )
}
