// WhatIfPanel.tsx — scenario forcings: ΔTemp, rainfall × factor, urban-heat bump, and the
// draw-urban tool. Sliders auto-run /whatif (debounced upstream), so there's no RUN button —
// the diff map and impact deltas update live. Shows the scenario date + urban cell count.

interface Props {
  date: string
  dateMin: string
  dateMax: string
  onDate: (d: string) => void
  deltaTemp: number
  onDeltaTemp: (v: number) => void
  rainPct: number
  onRainPct: (v: number) => void
  urbanLst: number
  onUrbanLst: (v: number) => void
  drawMode: boolean
  onToggleDraw: () => void
  urbanPoints: number
  urbanCells: number | null
  onClearUrban: () => void
  running: boolean
}

const PRESETS: Array<{ label: string; dt: number; rain: number; urban: number; tone: 'heat' | 'wet' | 'dry' | 'reset' }> = [
  { label: '+2°C HEATWAVE', dt: 2, rain: 100, urban: 0, tone: 'heat' },
  { label: 'MONSOON ×1.5', dt: 0, rain: 150, urban: 0, tone: 'wet' },
  { label: 'DROUGHT ×0.5', dt: 1, rain: 50, urban: 0, tone: 'dry' },
  { label: 'URBAN HEAT IS.', dt: 0, rain: 100, urban: 4, tone: 'heat' },
  { label: 'RESET', dt: 0, rain: 100, urban: 0, tone: 'reset' },
]
const TONE: Record<string, string> = {
  heat: 'border-danger/40 text-danger hover:bg-danger/10',
  wet: 'border-isro/40 text-isro hover:bg-isro/10',
  dry: 'border-saffron/40 text-saffron hover:bg-saffron/10',
  reset: 'border-line text-muted hover:text-ink hover:border-line',
}

export default function WhatIfPanel(p: Props) {
  const applyPreset = (dt: number, rain: number, urban: number) => {
    p.onDeltaTemp(dt)
    p.onRainPct(rain)
    p.onUrbanLst(urban)
  }
  return (
    <div className="space-y-3">
      {/* one-click scenario presets */}
      <div>
        <span className="font-mono text-[10px] tracking-[0.12em] text-muted">SCENARIO PRESETS</span>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {PRESETS.map((s) => (
            <button
              key={s.label}
              onClick={() => applyPreset(s.dt, s.rain, s.urban)}
              className={`rounded-full border px-2 py-1 font-mono text-[9px] tracking-[0.06em] transition-colors ${TONE[s.tone]}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] tracking-[0.12em] text-muted">SCENARIO DATE</span>
        <input
          type="date"
          value={p.date}
          min={p.dateMin}
          max={p.dateMax}
          onChange={(e) => p.onDate(e.target.value)}
          className="rounded border border-line bg-panel-2 px-2 py-1 font-mono text-[11px] text-ink [color-scheme:dark]"
        />
      </div>

      <Slider
        label="Δ TEMP"
        value={p.deltaTemp}
        min={-2}
        max={4}
        step={0.5}
        suffix="°C"
        onChange={p.onDeltaTemp}
        signed
      />
      <Slider
        label="RAINFALL"
        value={p.rainPct}
        min={50}
        max={150}
        step={5}
        suffix="%"
        onChange={p.onRainPct}
      />
      <Slider
        label="URBAN HEAT"
        value={p.urbanLst}
        min={0}
        max={6}
        step={0.5}
        suffix="°C"
        onChange={p.onUrbanLst}
      />

      <div className="flex items-center gap-2">
        <button
          onClick={p.onToggleDraw}
          className={`flex-1 rounded-md border px-2 py-1.5 font-mono text-[10px] tracking-[0.1em] transition-colors ${
            p.drawMode
              ? 'border-saffron/60 bg-saffron/10 text-saffron'
              : 'border-line text-muted hover:border-isro/40 hover:text-ink'
          }`}
        >
          {p.drawMode ? '◉ DRAWING URBAN' : '✎ DRAW URBAN'}
        </button>
        <button
          onClick={p.onClearUrban}
          disabled={p.urbanPoints === 0}
          className="rounded-md border border-line px-2 py-1.5 font-mono text-[10px] text-muted transition-colors enabled:hover:border-danger/50 enabled:hover:text-danger disabled:opacity-40"
        >
          CLEAR
        </button>
      </div>
      <div className="flex items-center justify-between font-mono text-[9px] text-muted">
        <span>
          {p.drawMode
            ? 'click the map to add vertices'
            : p.urbanPoints >= 3
              ? `urban polygon · ${p.urbanCells ?? 0} cells`
              : p.urbanPoints > 0
                ? `${p.urbanPoints} pts (need ≥3)`
                : 'no urban area'}
        </span>
        <span className={p.running ? 'text-saffron' : 'text-online'}>
          {p.running ? '● simulating' : '● live'}
        </span>
      </div>
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
  signed,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  suffix: string
  onChange: (v: number) => void
  signed?: boolean
}) {
  const shown = signed && value > 0 ? `+${value}` : `${value}`
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] tracking-[0.12em] text-muted">{label}</span>
        <span className="font-mono text-[11px] text-ink tabular-nums">
          {shown}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="ct-range mt-1 w-full"
      />
    </div>
  )
}
