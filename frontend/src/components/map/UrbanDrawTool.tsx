// UrbanDrawTool.tsx — click on the map (when active) to drop vertices of an urban area;
// the polygon is sent as /whatif urban_polygon for a localized heat bump. Renders the
// polygon + vertex dots. Inactive = renders the polygon read-only.

import { CircleMarker, Polygon, useMapEvents } from 'react-leaflet'
import { COLORS } from '../../theme'

interface Props {
  active: boolean
  points: [number, number][] // [lat,lon]
  onAddPoint: (p: [number, number]) => void
}

export default function UrbanDrawTool({ active, points, onAddPoint }: Props) {
  useMapEvents({
    click(e) {
      if (active) onAddPoint([e.latlng.lat, e.latlng.lng])
    },
  })

  return (
    <>
      {points.length >= 2 && (
        <Polygon
          positions={points}
          pathOptions={{
            color: COLORS.saffron,
            weight: 1.5,
            fillColor: COLORS.saffron,
            fillOpacity: 0.12,
            dashArray: '5 4',
          }}
          interactive={false}
        />
      )}
      {points.map((p, i) => (
        <CircleMarker
          key={i}
          center={p}
          radius={3}
          pathOptions={{ color: COLORS.saffron, fillColor: COLORS.saffron, fillOpacity: 1 }}
          interactive={false}
        />
      ))}
    </>
  )
}
