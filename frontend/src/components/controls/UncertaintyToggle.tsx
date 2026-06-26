// UncertaintyToggle.tsx — request MC-dropout uncertainty bands on the forecast. The bands
// only exist for the convlstm model; when the resolved model can't produce them the backend
// returns a deterministic forecast + a note, which we surface honestly instead of faking a band.

import { useAppDispatch, useAppState } from '../../state/useAppState'

export default function UncertaintyToggle() {
  const { uncertainty, forecast } = useAppState()
  const dispatch = useAppDispatch()
  const note = forecast?.uncertainty_note

  return (
    <div>
      <button
        onClick={() => dispatch({ type: 'SET_UNCERTAINTY', on: !uncertainty })}
        className={`flex w-full items-center justify-between rounded-md border px-2.5 py-1.5 font-mono text-[10px] tracking-[0.1em] transition-colors ${
          uncertainty
            ? 'border-saffron/60 bg-saffron/10 text-saffron'
            : 'border-line text-muted hover:border-isro/40 hover:text-ink'
        }`}
      >
        <span>UNCERTAINTY BAND</span>
        <span
          className={`grid h-4 w-7 place-items-center rounded-full text-[8px] ${
            uncertainty ? 'bg-saffron/30' : 'bg-line'
          }`}
        >
          {uncertainty ? 'ON' : 'OFF'}
        </span>
      </button>
      {uncertainty && (
        <div className="mt-1.5 rounded-md border border-isro/30 bg-isro/5 px-2 py-1 font-mono text-[9px] leading-snug text-muted">
          {note ?? 'click a map cell — its forecast chart (right) shows the ± band around the line.'}
        </div>
      )}
    </div>
  )
}
