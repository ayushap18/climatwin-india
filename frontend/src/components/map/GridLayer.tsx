// GridLayer.tsx — the 9×13 Delhi-NCR data grid as colored Leaflet rectangles. Colored by
// the active variable (blue→saffron via the variable colormap); hover tooltip; click to
// select. The selected cell gets a saffron outline. Fields come from the active timeline
// frame (observed /state or a /forecast day), so this takes a raw field array.

import { Rectangle, Tooltip } from 'react-leaflet'
import type { VarName } from '../../api/types'
import { colorForValue } from '../../lib/colormaps'
import { cellsFor, type Cell } from '../../lib/grid'
import { COLORS } from '../../theme'
import { useThemeColors } from '../../lib/useThemeColors'

interface Props {
  field: number[][]
  lat: number[]
  lon: number[]
  variable: VarName
  unit: string
  range: [number, number]
  res: number
  contrast?: number
  pulseAbove?: number // cells whose value exceeds this gently pulse (e.g. heat-stress Tmax)
  selected: { row: number; col: number } | null
  onSelect: (cell: { row: number; col: number }) => void
}

export default function GridLayer({
  field,
  lat,
  lon,
  variable,
  unit,
  range,
  res,
  contrast = 1,
  pulseAbove,
  selected,
  onSelect,
}: Props) {
  const theme = useThemeColors() // themed line color for unselected cell borders
  const cells = cellsFor(field, lat, lon, res)

  return (
    <>
      {cells.map((c: Cell) => {
        const isSel = selected?.row === c.i && selected?.col === c.j
        const fill = colorForValue(variable, c.value, range, contrast)
        const pulse = pulseAbove != null && c.value > pulseAbove
        return (
          <Rectangle
            key={`${c.i}-${c.j}`}
            bounds={c.bounds}
            pathOptions={{
              color: pulse ? COLORS.danger : isSel ? COLORS.saffron : theme.line,
              weight: isSel ? 2 : pulse ? 1 : 0.5,
              opacity: isSel ? 1 : pulse ? 0.9 : 0.4,
              fillColor: fill,
              fillOpacity: 0.72,
              className: pulse ? 'ct-heat-pulse' : undefined,
            }}
            eventHandlers={{ click: () => onSelect({ row: c.i, col: c.j }) }}
          >
            <Tooltip direction="top" opacity={1} className="ct-tooltip">
              <span className="font-mono text-[11px]">
                {variable.toUpperCase()} {c.value.toFixed(1)} {unit}
                <br />
                <span className="opacity-70">
                  {c.lat.toFixed(2)}°N, {c.lon.toFixed(2)}°E
                </span>
              </span>
            </Tooltip>
          </Rectangle>
        )
      })}
    </>
  )
}
