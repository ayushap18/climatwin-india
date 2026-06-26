// src/components/ui/field-heatmap.tsx
// Real-data heatmap built on @visx/heatmap (HeatmapRect): renders one of the app's
// [nlat][nlon] fields as gapped, rounded, opacity-graded cells — the "visx" look applied
// to live data. Colors come from a caller-supplied colorFn (theme + contrast aware).

import { Group } from '@visx/group'
import { HeatmapRect } from '@visx/heatmap'
import { scaleLinear } from '@visx/scale'

interface Bin {
  bin: number
  count: number
}
interface Column {
  bin: number
  bins: Bin[]
}

export interface FieldHeatmapProps {
  field: number[][] // [row=lat S→N][col=lon W→E]
  color: (value: number) => string
  width?: number
  gap?: number
  radius?: number
  title?: string
  sub?: string
  highlight?: string
}

export function FieldHeatmap({
  field,
  color,
  width = 184,
  gap = 2,
  radius = 2,
  title,
  sub,
  highlight,
}: FieldHeatmapProps) {
  const rows = field.length
  const cols = field[0]?.length ?? 1
  const cell = width / cols
  const height = cell * rows

  // visx expects column-major bins
  const data: Column[] = Array.from({ length: cols }, (_, x) => ({
    bin: x,
    bins: field.map((r, y) => ({ bin: y, count: r[x] ?? 0 })),
  }))

  const flat = field.flat()
  const lo = Math.min(...flat)
  const hi = Math.max(...flat)
  const xScale = scaleLinear<number>({ domain: [0, cols], range: [0, width] })
  const yScale = scaleLinear<number>({ domain: [0, rows], range: [height, 0] }) // row 0 (south) at bottom
  const opacity = hi > lo ? scaleLinear<number>({ domain: [lo, hi], range: [0.55, 1] }) : null

  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg
        width={width}
        height={height}
        className="rounded-md"
        style={{
          outline: highlight ? `1px solid ${highlight}66` : '1px solid rgb(var(--line))',
          boxShadow: highlight ? `0 0 22px -8px ${highlight}` : undefined,
        }}
      >
        <Group>
          <HeatmapRect
            data={data}
            xScale={(d) => xScale(d) ?? 0}
            yScale={(d) => yScale(d) ?? 0}
            colorScale={(v) => color(v as number)}
            opacityScale={(v) => (opacity ? opacity(v as number) ?? 1 : 1)}
            binWidth={cell}
            binHeight={cell}
            gap={gap}
          >
            {(heatmap) =>
              heatmap.map((heatmapBins) =>
                heatmapBins.map((bin) => (
                  <rect
                    key={`hm-${bin.row}-${bin.column}`}
                    x={bin.x}
                    y={bin.y}
                    width={bin.width}
                    height={bin.height}
                    rx={radius}
                    fill={bin.color}
                    fillOpacity={bin.opacity}
                  />
                )),
              )
            }
          </HeatmapRect>
        </Group>
      </svg>
      {title && <div className="font-mono text-[10px] tracking-[0.12em] text-ink">{title}</div>}
      {sub && <div className="font-mono text-[9px] text-muted">{sub}</div>}
    </div>
  )
}
