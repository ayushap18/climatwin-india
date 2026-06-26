// ForecastChart.tsx — time series of the selected cell's active variable across the whole
// timeline (past observed → forecast). A NOW reference line splits observed from forecast,
// the forecast span is shaded saffron, and an uncertainty band is drawn when std is present.

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { VarName } from '../../api/types'
import type { Frame, FrameData } from '../../state/useTimeline'
import { COLORS } from '../../theme'

interface Props {
  frames: Frame[]
  getData: (f: Frame) => FrameData | null
  variable: VarName
  unit: string
  cell: { row: number; col: number }
  nowDate: string
}

export default function ForecastChart({ frames, getData, variable, unit, cell, nowDate }: Props) {
  const data = frames.map((f) => {
    const d = getData(f)
    const v = d?.fields[variable]?.[cell.row]?.[cell.col]
    const s = d?.std?.[variable]?.[cell.row]?.[cell.col]
    const value = v == null || Number.isNaN(v) ? null : Number(v.toFixed(2))
    const band =
      s != null && value != null ? [Number((value - s).toFixed(2)), Number((value + s).toFixed(2))] : undefined
    return { label: f.date.slice(5), date: f.date, kind: f.kind, value, band }
  })

  const nowLabel = nowDate.slice(5)
  const lastLabel = data[data.length - 1]?.label
  const hasBand = data.some((d) => d.band)

  return (
    <div className="h-[150px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
          <CartesianGrid stroke={COLORS.line} strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: COLORS.muted, fontSize: 9, fontFamily: 'JetBrains Mono' }}
            stroke={COLORS.line}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: COLORS.muted, fontSize: 9, fontFamily: 'JetBrains Mono' }}
            stroke={COLORS.line}
            width={34}
          />
          <Tooltip
            contentStyle={{
              background: COLORS.panel,
              border: `1px solid ${COLORS.line}`,
              borderRadius: 6,
              fontFamily: 'JetBrains Mono',
              fontSize: 11,
            }}
            labelStyle={{ color: COLORS.muted }}
            formatter={(val: number) => [`${val} ${unit}`, variable]}
          />
          {/* forecast region shading */}
          {lastLabel && (
            <ReferenceArea x1={nowLabel} x2={lastLabel} fill={COLORS.saffron} fillOpacity={0.06} />
          )}
          {/* uncertainty band */}
          {hasBand && (
            <Area
              dataKey="band"
              stroke="none"
              fill={COLORS.saffron}
              fillOpacity={0.18}
              isAnimationActive={false}
              connectNulls
            />
          )}
          <Line
            type="monotone"
            dataKey="value"
            stroke={COLORS.isro}
            strokeWidth={2}
            dot={{ r: 2, fill: COLORS.isro }}
            activeDot={{ r: 4, fill: COLORS.saffron }}
            isAnimationActive={false}
            connectNulls
          />
          <ReferenceLine x={nowLabel} stroke={COLORS.online} strokeDasharray="3 3" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
