// ModelSelect.tsx — choose the forecaster. Options come from meta.models so it reflects
// what the backend actually has (here: persistence · climatology). Drives `model`, which
// makes useTimeline refetch the forecast.

import { useAppDispatch, useAppState } from '../../state/useAppState'

export default function ModelSelect() {
  const { meta, model } = useAppState()
  const dispatch = useAppDispatch()
  const models = meta?.models ?? []
  if (models.length === 0) return null

  return (
    <div className="flex gap-1">
      {models.map((m) => {
        const active = (model ?? meta?.default_model) === m
        return (
          <button
            key={m}
            onClick={() => dispatch({ type: 'SET_MODEL', model: m })}
            className={`flex-1 rounded-md border px-2 py-1.5 font-mono text-[10px] tracking-[0.1em] transition-colors ${
              active
                ? 'border-isro/60 bg-isro/10 text-ink'
                : 'border-line text-muted hover:border-isro/40 hover:text-ink'
            }`}
          >
            {m.toUpperCase()}
          </button>
        )
      })}
    </div>
  )
}
