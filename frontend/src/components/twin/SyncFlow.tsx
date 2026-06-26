// SyncFlow.tsx — the realtime twin-sync as a horizontal "inference path" (instead of the
// circular ring): REALITY → TWIN CORE → IMPACT, joined by dashed SYNCED links with a
// travelling dot. Theme-aware; shows the live sync % when provided.

interface Props {
  syncPct?: number | null
  assimilating?: boolean
}

export default function SyncFlow({ syncPct, assimilating }: Props) {
  const sync = syncPct == null ? null : Math.round(syncPct)
  const tone = sync == null ? '#7e8aa6' : sync >= 66 ? '#36d399' : sync >= 33 ? '#ff8a3d' : '#ff5470'

  return (
    <div className="rounded-xl border border-line bg-panel/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[10px] tracking-[0.28em] text-muted">TWIN SYNC-PATH</span>
        <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.1em]" style={{ color: tone }}>
          <span className="h-2 w-2 animate-pulse-dot rounded-full" style={{ background: tone, boxShadow: `0 0 8px ${tone}` }} />
          {sync == null ? 'live' : `${sync}% synced`}
        </span>
      </div>

      <div className="flex items-stretch justify-between gap-2">
        <Node icon={<MonitorIcon />} label="REALITY" sub="observed" />
        <Link label={assimilating ? 'ASSIMILATE' : 'MIRROR'} />
        <Node icon={<HexIcon />} label="TWIN CORE" sub="digital twin" accent value={sync == null ? undefined : `${sync}%`} />
        <Link label="SIMULATE" />
        <Node icon={<GridIcon />} label="IMPACT" sub="decisions" />
      </div>

      <div className="mt-3 text-center font-mono text-[10px] tracking-[0.18em] text-muted/70">
        OBSERVED · SIMULATED — DIVERGENCE TRACKED LIVE
      </div>
    </div>
  )
}

function Node({
  icon,
  label,
  sub,
  accent,
  value,
}: {
  icon: React.ReactNode
  label: string
  sub: string
  accent?: boolean
  value?: string
}) {
  return (
    <div
      className={`flex w-[34%] max-w-[200px] flex-col items-center justify-center rounded-lg border px-3 py-4 ${
        accent ? 'border-saffron/50 bg-saffron/5 shadow-glow-saffron' : 'border-line bg-panel-2/50'
      }`}
    >
      <div className={accent ? 'text-saffron' : 'text-muted'}>{icon}</div>
      <div className="mt-2 font-mono text-[11px] tracking-[0.16em] text-ink">{label}</div>
      <div className="font-mono text-[9px] text-muted">{sub}</div>
      {value && <div className="mt-1 font-mono text-[13px] font-bold text-saffron tabular-nums">{value}</div>}
    </div>
  )
}

function Link({ label }: { label: string }) {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center">
      <div className="relative h-px w-full" style={{ borderTop: '1px dashed rgb(var(--line))' }}>
        <span className="ct-flow-dot absolute top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-saffron" style={{ boxShadow: '0 0 6px #ff8a3d' }} />
      </div>
      <span className="mt-2 rounded border border-line bg-bg/70 px-1.5 py-0.5 font-mono text-[8px] tracking-[0.1em] text-saffron">
        ⤓ {label}
      </span>
    </div>
  )
}

function MonitorIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M9 20h6M12 16v4" />
    </svg>
  )
}
function HexIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M12 2.5l8 4.6v9.8l-8 4.6-8-4.6V7.1z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
function GridIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}
