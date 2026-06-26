// Overview.tsx — mission brief + live hero. A spinning Globe + the signature TwinCore at
// top, a CAPABILITIES grid that explains every feature (use-case · how it works · the math)
// and jumps to it, and a right column of live telemetry, the twin-loop readout, and
// provenance. All numbers come from the prefetched /state.

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import Globe from '../globe/Globe'
import SyncFlow from '../twin/SyncFlow'
import StatCard from '../panels/StatCard'
import ProvenanceFooter from '../shell/ProvenanceFooter'
import { twinBus, type TwinStage } from '../../api/client'
import { COLORS } from '../../theme'
import { prettyDate } from '../../lib/format'
import { useAppDispatch, useAppState, type ViewId } from '../../state/useAppState'

const STAGES: { id: TwinStage; desc: string }[] = [
  { id: 'MIRROR', desc: 'state ← observed cube' },
  { id: 'ASSIMILATE', desc: 'nudge toward obs' },
  { id: 'SIMULATE', desc: 'roll forward h days' },
  { id: 'PERTURB', desc: 'what-if scenario' },
  { id: 'IMPACT', desc: 'decision signals' },
]

interface Feature {
  id: ViewId | 'console'
  glyph: string
  title: string
  use: string
  how: string
  math: string
}

const FEATURES: Feature[] = [
  {
    id: 'twin',
    glyph: '⟳',
    title: 'DIGITAL TWIN',
    use: 'Watch the model mirror reality and drift as it predicts; re-sync by assimilating observations.',
    how: 'MIRROR → SIMULATE → compare vs obs → ASSIMILATE to re-anchor.',
    math: 'state = α·obs + (1−α)·state',
  },
  {
    id: 'explore',
    glyph: '⬢',
    title: 'EXPLORE MAP',
    use: 'Inspect the 9×13 Delhi-NCR grid for any day; click a cell for its forecast series.',
    how: 'Observed /state fields colored per variable; scrub the timeline into the forecast.',
    math: 'cell(i,j) @ (latᵢ, lonⱼ) ± res/2',
  },
  {
    id: 'whatif',
    glyph: '⤳',
    title: 'WHAT-IF',
    use: 'Stress-test a day — warmer, drier, or an urban heat island — and see who crosses thresholds.',
    how: 'Perturb the forward run, re-simulate, diff vs baseline.',
    math: 'Tmax += ΔT · rain ×= f · urban += δ',
  },
  {
    id: 'console',
    glyph: '›_',
    title: 'CONSOLE + AI',
    use: 'Ask in plain English ("when to sow?") or run commands — answers grounded in real data.',
    how: 'The AI calls the app’s own tools and replies from the numbers.',
    math: 'intent → tool() → grounded answer',
  },
  {
    id: 'validation',
    glyph: '✓',
    title: 'VALIDATION',
    use: 'Honest skill vs baselines: RMSE/MAE/corr and rain detection, with a spatial error map.',
    how: 'Score each forecaster on the temporal test split.',
    math: 'RMSE = √(mean((pred−obs)²))',
  },
  {
    id: 'downscale',
    glyph: '⊞',
    title: 'DOWNSCALE',
    use: 'Super-resolve a coarse field; SR-CNN vs bilinear with the % improvement.',
    how: 'Coarsen → upsample two ways → compare.',
    math: 'imp% = 100·(RMSEᵦ − RMSEₛ)/RMSEᵦ',
  },
]

export default function Overview() {
  const { state, meta } = useAppState()
  const dispatch = useAppDispatch()
  const impacts = state?.impacts
  const heatC = meta?.thresholds.heat_stress_tmax_c ?? 40
  const sowMm = meta?.thresholds.sowing_onset_mm ?? 20
  const downscaleOff = meta?.downscale_available === false

  const go = (id: Feature['id']) => {
    if (id === 'console') return // console is the global docked bar, not a view
    if (id === 'downscale' && downscaleOff) return
    dispatch({ type: 'SET_VIEW', view: id })
  }

  return (
    <div className="grid h-full grid-cols-1 gap-3 p-3 lg:grid-cols-[1fr_340px]">
      {/* ---- MAIN (scrolls): hero + capabilities ---- */}
      <section className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <div className="relative overflow-hidden rounded-xl border border-line bg-panel/40">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <div className="font-mono text-[11px] tracking-[0.22em] text-ink">REALITY ⟷ TWIN · LIVE</div>
            <div className="font-mono text-[10px] text-muted">
              {state ? prettyDate(state.date) : 'syncing…'}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-5 p-5">
            <motion.div initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.6 }}>
              <Globe size={200} />
            </motion.div>
            <motion.div
              onClick={() => dispatch({ type: 'SET_VIEW', view: 'twin' })}
              title="open the Digital Twin"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="min-w-[340px] flex-1 cursor-pointer transition-transform hover:scale-[1.01]"
            >
              <SyncFlow />
            </motion.div>
          </div>
        </div>

        {/* capabilities */}
        <div className="rounded-xl border border-line bg-panel/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <PanelTitle>CAPABILITIES — what it does · how it works · the math</PanelTitle>
            <span className="font-mono text-[9px] text-muted/60">click a card to open</span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {FEATURES.map((f) => {
              const disabled = (f.id === 'console') || (f.id === 'downscale' && downscaleOff)
              return (
                <button
                  key={f.id}
                  onClick={() => go(f.id)}
                  className={`group flex flex-col rounded-lg border border-line bg-panel-2/50 p-3 text-left transition-colors ${
                    disabled ? 'cursor-default opacity-90' : 'hover:border-isro/50 hover:bg-panel-2'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="grid h-6 w-6 place-items-center rounded border border-line font-mono text-xs text-saffron">
                      {f.glyph}
                    </span>
                    <span className="font-mono text-[11px] tracking-[0.12em] text-ink">{f.title}</span>
                    {f.id === 'downscale' && downscaleOff && (
                      <span className="ml-auto font-mono text-[8px] text-muted/60">needs checkpoint</span>
                    )}
                    {f.id === 'console' && (
                      <span className="ml-auto font-mono text-[8px] text-muted/60">bottom bar</span>
                    )}
                  </div>
                  <p className="mt-1.5 text-[11px] leading-snug text-muted">{f.use}</p>
                  <p className="mt-1.5 font-mono text-[9px] leading-snug text-muted/70">
                    <span className="text-isro">how·</span> {f.how}
                  </p>
                  <code className="mt-1.5 block rounded border border-line bg-bg/60 px-2 py-1 font-mono text-[9px] text-online">
                    {f.math}
                  </code>
                </button>
              )
            })}
          </div>
        </div>
      </section>

      {/* ---- RIGHT COLUMN ---- */}
      <aside className="flex min-h-0 flex-col gap-3">
        <div className="rounded-xl border border-line bg-panel/40 p-3">
          <PanelTitle>LIVE STATE</PanelTitle>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <StatCard label="Max Tmax" value={impacts?.max_tmax_c ?? null} unit="°C" accent={COLORS.saffron} alert={(impacts?.max_tmax_c ?? 0) >= heatC} />
            <StatCard label="Mean Rain" value={impacts?.mean_rainfall_mm ?? null} unit="mm" accent={COLORS.isro} />
            <StatCard label="Heat Stress" value={impacts ? impacts.heat_stress_fraction * 100 : null} unit="%" digits={0} accent={COLORS.danger} alert={(impacts?.heat_stress_fraction ?? 0) > 0} />
            <StatCard label="Dryness" value={impacts?.dryness_index ?? null} digits={2} accent={COLORS.online} sublabel="SPI-lite" />
          </div>
          <div className="mt-2 space-y-0.5 rounded-md border border-line bg-bg/50 px-2.5 py-2 font-mono text-[9px] leading-relaxed text-muted/80">
            <div><span className="text-isro">dryness</span> = (R − μ_doy)/σ_doy</div>
            <div><span className="text-danger">heat-stress</span> = fraction(Tmax &gt; {heatC}°C)</div>
            <div><span className="text-online">sowing</span> = first day Σrain ≥ {sowMm} mm</div>
          </div>
        </div>

        <div className="min-h-0 flex-1 rounded-xl border border-line bg-panel/40 p-3">
          <PanelTitle>TWIN LOOP</PanelTitle>
          <StageReadout />
        </div>

        <div className="rounded-xl border border-line bg-panel/40">
          <ProvenanceFooter />
        </div>
      </aside>
    </div>
  )
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">{children}</div>
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
            style={active ? { borderColor: 'rgba(255,138,61,0.4)', background: 'rgba(255,138,61,0.06)' } : undefined}
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
            <span className="font-mono text-[11px] tracking-[0.1em]" style={{ color: active ? COLORS.saffron : COLORS.ink }}>
              {s.id}
            </span>
            <span className="ml-auto font-mono text-[9px] text-muted">{s.desc}</span>
          </li>
        )
      })}
    </ul>
  )
}
