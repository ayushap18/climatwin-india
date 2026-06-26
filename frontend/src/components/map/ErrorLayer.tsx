// ErrorLayer.tsx — a sequential heatmap of a per-cell scalar (e.g. Tmax RMSE) on the map.
// Low = good (dark/blue), high = bad (saffron/red). Hover shows the cell value.

import { Rectangle, Tooltip } from 'react-leaflet'
import { colorForScale } from '../../lib/colormaps'
import { cellsFor, type Cell } from '../../lib/grid'

interface Props {
  field: number[][]
  lat: number[]
  lon: number[]
  range: [number, number]
  unit: string
  res: number
}

export default function ErrorLayer({ field, lat, lon, range, unit, res }: Props) {
  const cells = cellsFor(field, lat, lon, res)
  return (
    <>
      {cells.map((c: Cell) => (
        <Rectangle
          key={`${c.i}-${c.j}`}
          bounds={c.bounds}
          pathOptions={{
            color: '#1b2742',
            weight: 0.4,
            opacity: 0.35,
            fillColor: colorForScale(c.value, range, 'error'),
            fillOpacity: 0.78,
          }}
        >
          <Tooltip direction="top" opacity={1} className="ct-tooltip">
            <span className="font-mono text-[11px]">
              RMSE {c.value.toFixed(2)} {unit}
              <br />
              <span className="opacity-70">
                {c.lat.toFixed(2)}°N, {c.lon.toFixed(2)}°E
              </span>
            </span>
          </Tooltip>
        </Rectangle>
      ))}
    </>
  )
}
