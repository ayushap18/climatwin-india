// MetricsTable.tsx — baseline-relative skill for the selected horizon: RMSE/MAE/corr per
// variable per model (winner = lowest RMSE, highlighted), plus rainfall categorical skill
// (POD/FAR/CSI). Reads the nested /validate payload.

import type { ValidateResp, VarName } from '../../api/types'
import { COLORS } from '../../theme'
import InfoPopover from './InfoPopover'

const VARS: VarName[] = ['rainfall', 'tmax', 'tmin']

export default function MetricsTable({ v, horizon }: { v: ValidateResp; horizon: string }) {
  const models = v.models
  const byModel = v.horizons[horizon] ?? {}
  const summary = v.summary_rmse[horizon] ?? {}

  return (
    <div className="space-y-3">
      {VARS.map((vr) => {
        const best = summary[vr]?.best as string | undefined
        return (
          <div key={vr}>
            <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.15em] text-saffron">
              {vr}
            </div>
            <table className="w-full border-separate" style={{ borderSpacing: '0 2px' }}>
              <thead>
                <tr className="font-mono text-[9px] text-muted/70">
                  <th className="text-left font-normal">model</th>
                  <th className="text-right font-normal">RMSE</th>
                  <th className="text-right font-normal">MAE</th>
                  <th className="text-right font-normal">corr</th>
                </tr>
              </thead>
              <tbody>
                {models.map((m) => {
                  const cell = byModel[m]?.[vr]
                  const isBest = best === m
                  return (
                    <tr key={m} className="font-mono text-[11px]">
                      <td
                        className="text-left"
                        style={{ color: isBest ? COLORS.online : COLORS.ink }}
                      >
                        {isBest ? '■ ' : ''}
                        {m}
                      </td>
                      <td
                        className="text-right tabular-nums"
                        style={{ color: isBest ? COLORS.online : COLORS.ink }}
                      >
                        {cell?.RMSE != null ? cell.RMSE.toFixed(2) : '—'}
                      </td>
                      <td className="text-right tabular-nums text-muted">
                        {cell?.MAE != null ? cell.MAE.toFixed(2) : '—'}
                      </td>
                      <td className="text-right tabular-nums text-muted">
                        {cell?.corr != null ? cell.corr.toFixed(2) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })}

      {/* rainfall categorical skill */}
      <div>
        <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.15em] text-saffron">
          RAIN DETECTION
          <InfoPopover>
            Rain/no-rain skill at the wet-day threshold. POD = hit rate (↑ better), FAR =
            false-alarm rate (↓ better), CSI = critical success index (↑ better).
          </InfoPopover>
        </div>
        <table className="w-full border-separate" style={{ borderSpacing: '0 2px' }}>
          <thead>
            <tr className="font-mono text-[9px] text-muted/70">
              <th className="text-left font-normal">model</th>
              <th className="text-right font-normal">POD↑</th>
              <th className="text-right font-normal">FAR↓</th>
              <th className="text-right font-normal">CSI↑</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => {
              const cat = byModel[m]?.rainfall?.categorical
              return (
                <tr key={m} className="font-mono text-[11px] text-ink">
                  <td className="text-left">{m}</td>
                  <td className="text-right tabular-nums">{cat?.POD != null ? cat.POD.toFixed(2) : '—'}</td>
                  <td className="text-right tabular-nums">{cat?.FAR != null ? cat.FAR.toFixed(2) : '—'}</td>
                  <td className="text-right tabular-nums">{cat?.CSI != null ? cat.CSI.toFixed(2) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
