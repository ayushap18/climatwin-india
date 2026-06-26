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

const OUTLINE_STYLE: PathOptions = {
  color: COLORS.isro,
  weight: 1,
  opacity: 0.55,
  fill: true,
  fillColor: '#0a1228',
  fillOpacity: 0.35,
  interactive: false, // never intercept clicks meant for the data grid below
}

export default function DarkIndiaMap({
  bounds,
  children,
}: {
  bounds: LatLngBounds
  children?: React.ReactNode
}) {
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
      style={{ background: '#030408' }}
    >
      {india && (
        <GeoJSON
          data={india as unknown as GeoJSON.GeoJsonObject}
          style={() => OUTLINE_STYLE}
        />
      )}
      {children}
    </MapContainer>
  )
}
