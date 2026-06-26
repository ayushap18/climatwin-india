// HiResToggle.tsx — switch the map to the real INDmet 0.05° (~5 km) observed layer.
// This is genuine high-res DATA (5× finer than the 0.25° model grid), not a model output —
// available for observed rainfall days. Honest provenance is shown when active.

export default function HiResToggle({
  on,
  onChange,
  available,
  activeOk,
}: {
  on: boolean
  onChange: (b: boolean) => void
  available: boolean
  activeOk: boolean // the active variable + scrubbed day actually have a 0.05° field
}) {
  if (!available) return null
  return (
    <div>
      <button
        onClick={() => onChange(!on)}
        className={`flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 font-mono text-[10px] tracking-[0.12em] transition-colors ${
          on ? 'border-online/60 bg-online/10 text-online' : 'border-line text-muted hover:border-isro/40 hover:text-ink'
        }`}
      >
        <span>0.05° HI-RES · INDmet</span>
        <span className={`rounded px-1.5 py-0.5 text-[9px] ${on ? 'bg-online/30' : 'bg-line'}`}>
          {on ? 'ON' : 'OFF'}
        </span>
      </button>
      {on && !activeOk && (
        <div className="mt-1.5 rounded-md border border-saffron/30 bg-saffron/5 px-2 py-1 font-mono text-[9px] leading-snug text-muted">
          5 km layer covers observed <span className="text-saffron">rainfall</span> days — scrub to an
          observed day (rainfall layer) to see it.
        </div>
      )}
      {on && activeOk && (
        <div className="mt-1.5 rounded-md border border-online/30 bg-online/5 px-2 py-1 font-mono text-[9px] leading-snug text-muted">
          real 0.05° observations · INDmet (blended IMD + CHIRPS + ERA5-Land), not a model output
        </div>
      )}
    </div>
  )
}
