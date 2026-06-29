// TopBar.tsx — full-width header. Logo, ONLINE status, data provenance, active model,
// live IST/UTC clocks, last request latency, and a persistent mini TwinCore on the right.

import { useEffect, useState } from 'react'
import { getLastLatency } from '../../api/client'
import { clockIn } from '../../lib/format'
import { exportNodePng } from '../../lib/exportPng'
import { useAppState } from '../../state/useAppState'
import TwinCore from '../twin/TwinCore'
import SettingsPopover from './SettingsPopover'
import SourceSelect from '../controls/SourceSelect'

export default function TopBar() {
  const { meta, health, model } = useAppState()
  const [now, setNow] = useState(() => new Date())
  const [latency, setLatency] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(new Date())
      setLatency(getLastLatency())
    }, 1000)
    return () => window.clearInterval(id)
  }, [])

  const online = health?.status === 'ok'

  return (
    <header className="relative z-20 flex items-stretch justify-between border-b border-line bg-panel/80 backdrop-blur-md">
      {/* left: identity */}
      <div className="flex items-center gap-3 px-4 py-2">
        <div className="grid h-8 w-8 place-items-center rounded-md border border-isro/40 bg-panel-2 font-mono text-sm text-saffron shadow-glow">
          CT
        </div>
        <div className="leading-tight">
          <div className="font-mono text-sm tracking-[0.22em] text-ink">CLIMATWIN INDIA</div>
          <div className="font-mono text-[9px] tracking-[0.3em] text-muted">
            {meta?.region?.toUpperCase() ?? 'DELHI-NCR'} · DIGITAL TWIN
          </div>
        </div>
      </div>

      {/* center: telemetry strip */}
      <div className="hidden items-center gap-6 px-4 font-mono text-[10px] text-muted md:flex">
        <Stat label="STATUS">
          <span className="inline-flex items-center gap-1.5">
            <span
              className={`h-2 w-2 rounded-full ${online ? 'animate-pulse-dot bg-online' : 'bg-danger'}`}
              style={{ boxShadow: online ? '0 0 8px #36d399' : '0 0 8px #ff5470' }}
            />
            <span className={online ? 'text-online' : 'text-danger'}>
              {online ? 'ONLINE' : 'OFFLINE'}
            </span>
          </span>
        </Stat>
        <SourceSelect />
        <Stat label="MODEL">
          <span className="text-saffron">{(model ?? '—').toUpperCase()}</span>
        </Stat>
        <Stat label="SYSTEMS">
          <span className="inline-flex items-center gap-1.5">
            <Led on={online} title="data" label="DATA" />
            <Led on={(meta?.models?.length ?? 0) > 2} title="models" label="ML" />
            <Led on={!!meta?.highres_available} title="INDmet 0.05° high-res" label="HR" />
            <Led on={!!meta?.diffusion_available} title="diffusion downscaler" label="DIF" />
          </span>
        </Stat>
        <Stat label="IST">
          <span className="text-ink tabular-nums">{clockIn('Asia/Kolkata', now)}</span>
        </Stat>
        <Stat label="UTC">
          <span className="text-ink tabular-nums">{clockIn('UTC', now)}</span>
        </Stat>
        <Stat label="LATENCY">
          <span className="text-ink tabular-nums">{latency}ms</span>
        </Stat>
      </div>

      {/* right: export + settings + persistent mini twin core */}
      <div className="flex items-center gap-2 pr-3">
        <button
          onClick={() => exportNodePng(document.querySelector('main'), `climatwin-${Date.now()}.png`)}
          title="export the current view as PNG"
          className="grid h-7 w-7 place-items-center rounded-md border border-line text-muted transition-colors hover:border-isro/50 hover:text-ink"
        >
          <span className="font-mono text-[11px]">⤓</span>
        </button>
        <SettingsPopover />
        <TwinCore size={48} showLabels={false} showCenter={false} />
      </div>
    </header>
  )
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-[8px] tracking-[0.2em] text-muted/70">{label}</span>
      <span>{children}</span>
    </div>
  )
}

function Led({ on, title, label }: { on: boolean; title: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" title={title}>
      <span
        className={`h-1.5 w-1.5 rounded-full ${on ? 'bg-online' : 'bg-line'}`}
        style={on ? { boxShadow: '0 0 6px #36d399' } : undefined}
      />
      <span className={`text-[8px] ${on ? 'text-ink/70' : 'text-muted/40'}`}>{label}</span>
    </span>
  )
}
