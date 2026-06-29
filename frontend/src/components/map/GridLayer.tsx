// GridLayer.tsx — the 9×13 Delhi-NCR data grid as colored Leaflet rectangles. Colored by
// the active variable (blue→saffron via the variable colormap); hover tooltip; click to
// select. The selected cell gets a saffron outline. Fields come from the active timeline
// frame (observed /state or a /forecast day), so this takes a raw field array.

import { Rectangle, Tooltip } from 'react-leaflet'
import type { LayerVar } from '../../api/types'
import { colorForValue } from '../../lib/colormaps'
import { cellsFor, type Cell } from '../../lib/grid'
import { COLORS } from '../../theme'
import { useThemeColors } from '../../lib/useThemeColors'

interface Props {
  field: number[][]
  lat: number[]
  lon: number[]
  variable: LayerVar
  unit: string
  range: [number, number]
  res: number
  contrast?: number
  pulseAbove?: number // cells whose value exceeds this gently pulse (e.g. heat-stress Tmax)
  seriesFor?: (row: number, col: number) => number[] // per-cell timeline series → hover sparkline
  selected: { row: number; col: number } | null
  onSelect: (cell: { row: number; col: number }) => void
  colorFn?: (value: number) => string // override the per-variable colormap (e.g. terrain relief)
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
  seriesFor,
  selected,
  onSelect,
  colorFn,
}: Props) {
  const theme = useThemeColors() // themed line color for unselected cell borders
  const cells = cellsFor(field, lat, lon, res)

  return (
    <>
      {cells.map((c: Cell) => {
        const isSel = selected?.row === c.i && selected?.col === c.j
        const fill = colorFn ? colorFn(c.value) : colorForValue(variable, c.value, range, contrast)
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
                {seriesFor && <Sparkline values={seriesFor(c.i, c.j)} />}
              </span>
            </Tooltip>
          </Rectangle>
        )
      })}
    </>
  )
}

/** A tiny inline sparkline of a cell's series across the timeline (past → forecast). */
function Sparkline({ values }: { values: number[] }) {
  const xs = values.filter((v) => Number.isFinite(v))
  if (xs.length < 2) return null
  const w = 96
  const h = 22
  const min = Math.min(...xs)
  const max = Math.max(...xs)
  const span = max - min || 1
  const pts = xs
    .map((v, i) => `${(i / (xs.length - 1)) * w},${h - ((v - min) / span) * (h - 3) - 1.5}`)
    .join(' ')
  return (
    <svg width={w} height={h} className="mt-1 block" style={{ overflow: 'visible' }}>
      <polyline points={pts} fill="none" stroke="#2b6cff" strokeWidth={1.5} />
      <circle
        cx={w}
        cy={h - ((xs[xs.length - 1] - min) / span) * (h - 3) - 1.5}
        r={1.8}
        fill="#ff8a3d"
      />
    </svg>
  )
}
