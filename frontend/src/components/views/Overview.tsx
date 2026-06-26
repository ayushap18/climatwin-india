// Overview.tsx — the live hero. Follows the approved layout: a large MAIN area
// (spinning Globe + the signature TwinCore) and a RIGHT COLUMN of three stacked panels
// (live telemetry StatCards, the twin-loop stage readout, and the provenance footer).
// All numbers come from the prefetched /state.

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import Globe from '../globe/Globe'
import TwinCore from '../twin/TwinCore'
import StatCard from '../panels/StatCard'
import ProvenanceFooter from '../shell/ProvenanceFooter'
import { twinBus, type TwinStage } from '../../api/client'
import { COLORS } from '../../theme'
import { prettyDate } from '../../lib/format'
import { useAppState } from '../../state/useAppState'

const STAGES: { id: TwinStage; desc: string }[] = [
  { id: 'MIRROR', desc: 'state ← observed cube' },
  { id: 'ASSIMILATE', desc: 'nudge toward obs' },
  { id: 'SIMULATE', desc: 'roll forward h days' },
  { id: 'PERTURB', desc: 'what-if scenario' },
  { id: 'IMPACT', desc: 'decision signals' },
]

export default function Overview() {
  const { state, meta } = useAppState()
  const impacts = state?.impacts
  const heatC = meta?.thresholds.heat_stress_tmax_c ?? 40

  return (
    <div className="grid h-full grid-cols-1 gap-3 p-3 lg:grid-cols-[1fr_340px]">
      {/* ---- MAIN ---- */}
      <section className="relative flex min-h-[420px] flex-col overflow-hidden rounded-xl border border-line bg-panel/40">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <div className="font-mono text-[11px] tracking-[0.22em] text-ink">
            REALITY ⟷ TWIN · LIVE
          </div>
          <div className="font-mono text-[10px] text-muted">
            {state ? prettyDate(state.date) : 'syncing…'}
          </div>
        </div>

        <div className="flex flex-1 flex-wrap items-center justify-center gap-6 p-6">
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6 }}
          >
            <Globe size={300} />
          </motion.div>
          <motion.div
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.1 }}
          >
            <TwinCore size={340} />
          </motion.div>
        </div>
      </section>

      {/* ---- RIGHT COLUMN: three stacked panels ---- */}
      <aside className="flex min-h-0 flex-col gap-3">
        {/* panel 1: live telemetry */}
        <div className="rounded-xl border border-line bg-panel/40 p-3">
          <PanelTitle>LIVE STATE</PanelTitle>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <StatCard
              label="Max Tmax"
              value={impacts?.max_tmax_c ?? null}
              unit="°C"
              accent={COLORS.saffron}
              alert={(impacts?.max_tmax_c ?? 0) >= heatC}
            />
            <StatCard
              label="Mean Rain"
              value={impacts?.mean_rainfall_mm ?? null}
              unit="mm"
              accent={COLORS.isro}
            />
            <StatCard
              label="Heat Stress"
              value={impacts ? impacts.heat_stress_fraction * 100 : null}
              unit="%"
              digits={0}
              accent={COLORS.danger}
              alert={(impacts?.heat_stress_fraction ?? 0) > 0}
            />
            <StatCard
              label="Dryness"
              value={impacts?.dryness_index ?? null}
              digits={2}
              accent={COLORS.online}
              sublabel="SPI-lite"
            />
          </div>
        </div>

        {/* panel 2: twin-loop stage readout */}
        <div className="min-h-0 flex-1 rounded-xl border border-line bg-panel/40 p-3">
          <PanelTitle>TWIN LOOP</PanelTitle>
          <StageReadout />
        </div>

        {/* panel 3: provenance */}
        <div className="rounded-xl border border-line bg-panel/40">
          <ProvenanceFooter />
        </div>
      </aside>
    </div>
  )
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
      {children}
    </div>
  )
}

/** A live list of the five twin stages; the last-fired stage glows. */
function StageReadout() {
  const [last, setLast] = useState<TwinStage | null>(null)
  useEffect(() => twinBus.subscribe((s) => setLast(s)), [])

  return (
    <ul className="mt-2 space-y-1.5">
      {STAGES.map((s, i) => {
        const active = last === s.id
        return (
          <li
            key={s.id}
            className="flex items-center gap-2.5 rounded-md border border-transparent px-2 py-1.5 transition-colors"
            style={
              active
                ? { borderColor: 'rgba(255,138,61,0.4)', background: 'rgba(255,138,61,0.06)' }
                : undefined
            }
          >
            <span
              className="grid h-5 w-5 place-items-center rounded-full font-mono text-[9px]"
              style={{
                background: active ? COLORS.saffron : COLORS.panel2,
                color: active ? '#05070d' : COLORS.muted,
                boxShadow: active ? '0 0 10px rgba(255,138,61,0.7)' : undefined,
              }}
            >
              {i + 1}
            </span>
            <span
              className="font-mono text-[11px] tracking-[0.1em]"
              style={{ color: active ? COLORS.saffron : COLORS.ink }}
            >
              {s.id}
            </span>
            <span className="ml-auto font-mono text-[9px] text-muted">{s.desc}</span>
          </li>
        )
      })}
    </ul>
  )
}
