// ColorBar.tsx — legend for the active variable. The gradient matches the grid colormap
// and the lo/hi labels come straight from meta.colorbar_ranges so colors == data scale.

import type { VarName } from '../../api/types'
import { gradientCss } from '../../lib/colormaps'

export default function ColorBar({
  variable,
  range,
  unit,
}: {
  variable: VarName
  range: [number, number]
  unit?: string
}) {
  return (
    <div>
      <div
        className="h-2.5 w-full rounded-full border border-line"
        style={{ background: gradientCss(variable) }}
      />
      <div className="mt-1 flex justify-between font-mono text-[9px] text-muted">
        <span>
          {range[0]}
          {unit ? ` ${unit}` : ''}
        </span>
        <span className="uppercase tracking-[0.15em] text-muted/70">{variable}</span>
        <span>
          {range[1]}
          {unit ? ` ${unit}` : ''}
        </span>
      </div>
    </div>
  )
}
