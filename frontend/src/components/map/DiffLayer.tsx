// DiffLayer.tsx — the scenario−baseline difference for the active variable as a diverging
// heatmap (blue = cooler/drier, saffron = hotter/wetter, neutral at 0), symmetric about 0.
// Always non-interactive: it's a read-out layer, and keeping pointer-events off lets the
// urban-draw tool receive every map click (and avoids tooltip churn on rapid re-runs).

import { Rectangle } from 'react-leaflet'
import { colorForDiff } from '../../lib/colormaps'
import { cellsFor, type Cell } from '../../lib/grid'

interface Props {
  diff: number[][]
  lat: number[]
  lon: number[]
  magnitude: number
  res: number
}

export default function DiffLayer({ diff, lat, lon, magnitude, res }: Props) {
  const cells = cellsFor(diff, lat, lon, res)

  return (
    <>
      {cells.map((c: Cell) => (
        <Rectangle
          key={`${c.i}-${c.j}`}
          bounds={c.bounds}
          interactive={false}
          pathOptions={{
            color: '#1b2742',
            weight: 0.4,
            opacity: 0.35,
            fillColor: colorForDiff(c.value, magnitude),
            fillOpacity: 0.78,
          }}
        />
      ))}
    </>
  )
}
