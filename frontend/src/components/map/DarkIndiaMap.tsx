// DarkIndiaMap.tsx — a tile-less Leaflet map: glowing blue state outlines on near-black,
// fitted to the Delhi-NCR pilot grid. No basemap, no network — the only vector source is
// the bundled india-adm1.geojson. The colored data grid is layered in as children.

import 'leaflet/dist/leaflet.css'
import { useEffect, useState } from 'react'
import { GeoJSON, MapContainer } from 'react-leaflet'
import type { PathOptions } from 'leaflet'
import { loadIndiaAdm1, type IndiaFC } from '../../lib/geojson'
import type { LatLngBounds } from '../../lib/grid'
import { COLORS } from '../../theme'
import { useAppState } from '../../state/useAppState'

// State outline styling per theme — dark = glowing blue on near-black, light = crisp blue
// on a pale wash so the same vectors read well on paper.
const OUTLINE_STYLE: Record<'dark' | 'light', PathOptions> = {
  dark: {
    color: COLORS.isro,
    weight: 1,
    opacity: 0.55,
    fill: true,
    fillColor: '#0a1228',
    fillOpacity: 0.35,
    interactive: false, // never intercept clicks meant for the data grid below
  },
  light: {
    color: COLORS.isro,
    weight: 1,
    opacity: 0.8,
    fill: true,
    fillColor: '#dce6fb',
    fillOpacity: 0.5,
    interactive: false,
  },
}

export default function DarkIndiaMap({
  bounds,
  children,
}: {
  bounds: LatLngBounds
  children?: React.ReactNode
}) {
  const { theme } = useAppState()
  const [india, setIndia] = useState<IndiaFC | null>(null)

  useEffect(() => {
    let on = true
    loadIndiaAdm1()
      .then((fc) => on && setIndia(fc))
      .catch(() => on && setIndia(null))
    return () => {
      on = false
    }
  }, [])

  return (
    <MapContainer
      bounds={bounds}
      boundsOptions={{ padding: [24, 24] }}
      zoomControl={false}
      attributionControl={false}
      scrollWheelZoom
      className="h-full w-full"
      // follow the themed page background instead of a fixed near-black
      style={{ background: 'rgb(var(--bg))' }}
    >
      {india && (
        <GeoJSON
          key={theme} // restyle outlines when the theme flips
          data={india as unknown as GeoJSON.GeoJsonObject}
          style={() => OUTLINE_STYLE[theme]}
        />
      )}
      {children}
    </MapContainer>
  )
}
