// LayerSwitch.tsx — pick the active map layer. The 3 forecast variables (rainfall · tmax ·
// tmin) always; plus any regime-extra OBSERVATION layer the active source carries (real
// INSAT-3D LST for the insat_real regime). Selection drives activeVariable (a LayerVar).

import type { LayerVar } from '../../api/types'
import { useAppDispatch, useAppState } from '../../state/useAppState'

const LABEL: Record<string, string> = {
  rainfall: 'RAINFALL',
  tmax: 'TMAX',
  tmin: 'TMIN',
  lst: 'INSAT LST',
}

export default function LayerSwitch() {
  const { meta, activeVariable, source } = useAppState()
  const dispatch = useAppDispatch()
  const base = (meta?.variables ?? ['rainfall', 'tmax', 'tmin']) as LayerVar[]
  const extras = (meta?.sources?.find((s) => s.key === (source ?? 'synthetic'))?.extra_vars ??
    []) as LayerVar[]
  const vars: LayerVar[] = [...base, ...extras]

  return (
    <div className="flex gap-1">
      {vars.map((v) => {
        const active = activeVariable === v
        const isExtra = v === 'lst'
        return (
          <button
            key={v}
            onClick={() => dispatch({ type: 'SET_VARIABLE', variable: v })}
            title={isExtra ? 'Real INSAT-3D land-surface temperature (observed)' : undefined}
            className={`flex-1 rounded-md border px-2 py-1.5 font-mono text-[10px] tracking-[0.1em] transition-colors ${
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
