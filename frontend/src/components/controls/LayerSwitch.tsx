// LayerSwitch.tsx — pick the active grid variable (rainfall · tmax · tmin). Options come
// from meta.variables so it tracks the backend; selection drives activeVariable.

import type { VarName } from '../../api/types'
import { useAppDispatch, useAppState } from '../../state/useAppState'

const LABEL: Record<VarName, string> = {
  rainfall: 'RAINFALL',
  tmax: 'TMAX',
  tmin: 'TMIN',
}

export default function LayerSwitch() {
  const { meta, activeVariable } = useAppState()
  const dispatch = useAppDispatch()
  const vars = (meta?.variables ?? ['rainfall', 'tmax', 'tmin']) as VarName[]

  return (
    <div className="flex gap-1">
      {vars.map((v) => {
        const active = activeVariable === v
        return (
          <button
            key={v}
            onClick={() => dispatch({ type: 'SET_VARIABLE', variable: v })}
            className={`flex-1 rounded-md border px-2 py-1.5 font-mono text-[10px] tracking-[0.12em] transition-colors ${
              active
                ? 'border-saffron/60 bg-saffron/10 text-saffron'
                : 'border-line text-muted hover:border-isro/40 hover:text-ink'
            }`}
          >
            {LABEL[v] ?? v.toUpperCase()}
          </button>
        )
      })}
    </div>
  )
}
