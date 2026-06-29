// MapModeToggle.tsx — segmented 3D/2D switch for the insat_real terrain view.
// Pure presentational: the caller owns the mode and gates what renders. Matches the
// ModelSelect button idiom (font-mono, bordered, isro-tinted active state).

type MapMode = '3d' | '2d'

const MODES: { id: MapMode; label: string }[] = [
  { id: '3d', label: '3D' },
  { id: '2d', label: '2D' },
]

export default function MapModeToggle({
  value,
  onChange,
}: {
  value: MapMode
  onChange: (mode: MapMode) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-1">
      {MODES.map((m) => {
        const active = value === m.id
        return (
          <button
            key={m.id}
            onClick={() => onChange(m.id)}
            title={m.id === '3d' ? '3D terrain relief' : 'Flat 2D map'}
            className={`min-w-0 rounded-md border px-1 py-1.5 text-center font-mono text-[10px] tracking-[0.06em] transition-colors ${
              active
                ? 'border-isro/60 bg-isro/10 text-saffron'
                : 'border-line text-muted hover:border-isro/40 hover:text-ink'
            }`}
          >
            {m.label}
          </button>
        )
      })}
    </div>
  )
}
