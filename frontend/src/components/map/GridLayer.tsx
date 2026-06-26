// GridLayer.tsx — the 9×13 Delhi-NCR data grid as colored Leaflet rectangles. Each cell
// is colored by the active variable (blue→saffron via the variable colormap), shows a
// hover tooltip, and selects on click. The selected cell gets a saffron outline.

import { Rectangle, Tooltip } from 'react-leaflet'
import type { VarName } from '../../api/types'
import { colorForValue } from '../../lib/colormaps'
import { cellsFor, type Cell } from '../../lib/grid'
import type { StateResp } from '../../api/types'
import { COLORS } from '../../theme'

interface Props {
  state: StateResp
  variable: VarName
  range: [number, number]
  res: number
  selected: { row: number; col: number } | null
  onSelect: (cell: { row: number; col: number }) => void
}

export default function GridLayer({ state, variable, range, res, selected, onSelect }: Props) {
  const cells = cellsFor(state, variable, res)
  const unit = state.units[variable] ?? ''

  return (
    <>
      {cells.map((c: Cell) => {
        const isSel = selected?.row === c.i && selected?.col === c.j
        const fill = colorForValue(variable, c.value, range)
        return (
          <Rectangle
            key={`${c.i}-${c.j}`}
            bounds={c.bounds}
            pathOptions={{
              color: isSel ? COLORS.saffron : COLORS.line,
              weight: isSel ? 2 : 0.5,
              opacity: isSel ? 1 : 0.4,
              fillColor: fill,
              fillOpacity: 0.72,
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
