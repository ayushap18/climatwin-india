// FieldGrid.tsx — render a [nlat][nlon] field as a compact colored SVG grid (north up).
// Generic via a colorFn so it serves reality/twin (variable colormap) and divergence
// (error colormap). Lightweight (no leaflet) for side-by-side twin panels.

interface Props {
  field: number[][]
  colorFn: (value: number) => string
  title: string
  sub?: string
  width?: number
  highlight?: string // optional glow color (e.g. for the TWIN panel)
}

export default function FieldGrid({ field, colorFn, title, sub, width = 200, highlight }: Props) {
  const rows = field.length
  const cols = field[0]?.length ?? 1
  const cell = width / cols
  const h = cell * rows
  return (
    <div className="flex flex-col items-center gap-1.5">
      <svg
        width={width}
        height={h}
        className="rounded-md"
        style={{
          outline: highlight ? `1px solid ${highlight}66` : '1px solid #161c2e',
          boxShadow: highlight ? `0 0 22px -8px ${highlight}` : undefined,
        }}
      >
        {field.map((row, i) =>
          row.map((val, j) => (
            <rect
              key={`${i}-${j}`}
              x={j * cell}
              y={(rows - 1 - i) * cell}
              width={cell + 0.5}
              height={cell + 0.5}
              fill={colorFn(val)}
            />
          )),
        )}
      </svg>
      <div className="font-mono text-[10px] tracking-[0.14em] text-ink">{title}</div>
      {sub && <div className="font-mono text-[9px] text-muted">{sub}</div>}
    </div>
  )
}
