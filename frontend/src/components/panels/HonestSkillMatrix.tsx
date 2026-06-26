// HonestSkillMatrix.tsx — the "where each model earns its keep" view. For every variable ×
// horizon it shows the winning model and how much it beats the best BASELINE
// (persistence/climatology) — green when a learned model wins, amber when a baseline does
// (an honest "we don't always win"). Plus the ensemble's verified conformal coverage.

import type { ValidateResp, VarName } from '../../api/types'

const VARS: VarName[] = ['rainfall', 'tmax', 'tmin']
const BASELINES = ['persistence', 'climatology']
const SHORT: Record<string, string> = {
  persistence: 'PERS', climatology: 'CLIM', analog: 'ANLG', convlstm: 'CLSTM', ensemble: 'ENS',
}

function cellInfo(summary: Record<string, number | string> | undefined) {
  if (!summary) return null
  const best = summary.best as string
  const rmse = (m: string) => summary[`${m}_RMSE`] as number | undefined
  const bestR = rmse(best)
  const baseR = Math.min(...BASELINES.map((b) => rmse(b) ?? Infinity))
  const learned = !!best && !BASELINES.includes(best)
  const imp = baseR != null && isFinite(baseR) && bestR != null ? ((baseR - bestR) / baseR) * 100 : 0
  return { best, learned, imp }
}

export default function HonestSkillMatrix({ v }: { v: ValidateResp }) {
  const horizons = Object.keys(v.horizons)
  const cal = v.calibration

  return (
    <div className="space-y-3">
      <table className="w-full border-separate" style={{ borderSpacing: '0 3px' }}>
        <thead>
          <tr className="font-mono text-[9px] text-muted/70">
            <th className="text-left font-normal">vs baselines</th>
            {horizons.map((h) => (
              <th key={h} className="text-center font-normal">{h}d</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {VARS.map((vr) => (
            <tr key={vr} className="font-mono text-[10px]">
              <td className="py-0.5 pr-2 text-left uppercase tracking-[0.1em] text-saffron">{vr}</td>
              {horizons.map((h) => {
                const info = cellInfo(v.summary_rmse[h]?.[vr])
                if (!info) return <td key={h} className="text-center text-muted">—</td>
                const win = info.learned && info.imp > 0.05
                return (
                  <td key={h} className="px-0.5 py-0.5 text-center">
                    <div
                      className={`rounded border px-1 py-0.5 ${
                        win
                          ? 'border-online/40 bg-online/10 text-online'
                          : 'border-saffron/30 bg-saffron/5 text-saffron/90'
                      }`}
                      title={win ? `${info.best} beats best baseline by ${info.imp.toFixed(1)}%` : `${info.best} (a baseline) wins here`}
                    >
                      <div className="text-[10px] font-semibold leading-tight">{SHORT[info.best] ?? info.best}</div>
                      <div className="text-[8px] leading-tight opacity-90">
                        {win ? `+${info.imp.toFixed(0)}%` : 'baseline'}
                      </div>
                    </div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center gap-3 font-mono text-[8px] text-muted/70">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm border border-online/40 bg-online/10" /> learned model beats baselines</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm border border-saffron/30 bg-saffron/5" /> a baseline is hard to beat (honest)</span>
      </div>

      {cal && (
        <div className="rounded-md border border-isro/30 bg-isro/5 px-2.5 py-2">
          <div className="mb-1 font-mono text-[9px] tracking-[0.12em] text-isro">
            CALIBRATED UNCERTAINTY · {Math.round(cal.target * 100)}% bands{' '}
            {cal.coverage_split === 'test' ? '· out-of-sample TEST coverage' : ''}
          </div>
          <table className="w-full border-separate font-mono text-[9px]" style={{ borderSpacing: '0 1px' }}>
            <thead>
              <tr className="text-muted/70">
                <th className="text-left font-normal">coverage</th>
                {horizons.map((h) => <th key={h} className="text-center font-normal">{h}d</th>)}
              </tr>
            </thead>
            <tbody>
              {VARS.map((vr) => (
                <tr key={vr}>
                  <td className="pr-2 text-left uppercase tracking-[0.08em] text-muted">{vr}</td>
                  {horizons.map((h) => {
                    const c = cal.coverage?.[vr]?.[h]
                    if (c == null) return <td key={h} className="text-center text-muted">—</td>
                    const good = Math.abs(c - cal.target) <= 0.05
                    return (
                      <td key={h} className={`text-center tabular-nums ${good ? 'text-online' : 'text-saffron'}`}>
                        {(c * 100).toFixed(0)}%
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 font-mono text-[8px] leading-snug text-muted/70">
            % of {cal.coverage_split === 'test' ? 'untouched 2022–2023 test' : 'held-out'} days the band
            actually covered — close to {Math.round(cal.target * 100)}% = honestly calibrated. Half-widths
            set on {cal.split?.calib_years?.[0]} (disjoint), never on the test years.
          </p>
        </div>
      )}
    </div>
  )
}
