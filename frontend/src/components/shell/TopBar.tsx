// TopBar.tsx — full-width header. Logo, ONLINE status, data provenance, active model,
// live IST/UTC clocks, last request latency, and a persistent mini TwinCore on the right.

import { useEffect, useState } from 'react'
import { getLastLatency } from '../../api/client'
import { clockIn } from '../../lib/format'
import { useAppState } from '../../state/useAppState'
import TwinCore from '../twin/TwinCore'

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
  const source = (health?.data_source ?? meta?.data_source ?? '—').toUpperCase()
  const lst = meta?.lst_source ? meta.lst_source.toUpperCase() : null

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
        <Stat label="SOURCE">
          <span className="text-ink">{source}</span>
          {lst && <span className="text-muted"> · LST {lst}</span>}
        </Stat>
        <Stat label="MODEL">
          <span className="text-saffron">{(model ?? '—').toUpperCase()}</span>
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

      {/* right: persistent mini twin core */}
      <div className="flex items-center pr-3">
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
