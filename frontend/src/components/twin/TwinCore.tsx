// TwinCore.tsx — the signature loop. Five digital-twin stages arranged on a ring:
// MIRROR -> ASSIMILATE -> SIMULATE -> PERTURB -> IMPACT. A saffron pulse travels the
// ring continuously; each node flares when its stage fires on the twinBus (i.e. when
// the matching API call runs). Center shows the REALITY <-> TWIN sync gauge.
// One component, two sizes: large in the Overview hero, mini in the TopBar.

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { twinBus, type TwinStage } from '../../api/client'
import { COLORS } from '../../theme'

const STAGES: TwinStage[] = ['MIRROR', 'ASSIMILATE', 'SIMULATE', 'PERTURB', 'IMPACT']

interface Props {
  size?: number
  showLabels?: boolean
  showCenter?: boolean
}

export default function TwinCore({ size = 320, showLabels = true, showCenter = true }: Props) {
  const [flares, setFlares] = useState<Record<string, number>>({})
  // monotonically increasing token per stage so repeated flares retrigger the animation
  const tokenRef = useRef(0)

  useEffect(() => {
    return twinBus.subscribe((stage) => {
      tokenRef.current += 1
      const tok = tokenRef.current
      setFlares((f) => ({ ...f, [stage]: tok }))
      // clear after the flare animation window
      window.setTimeout(() => {
        setFlares((f) => (f[stage] === tok ? { ...f, [stage]: 0 } : f))
      }, 1100)
    })
  }, [])

  const cx = size / 2
  const cy = size / 2
  const r = size * 0.36
  const nodeR = Math.max(4, size * 0.035)

  const points = STAGES.map((stage, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / STAGES.length
    return {
      stage,
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
      angle,
    }
  })

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="overflow-visible"
      role="img"
      aria-label="Digital twin loop"
    >
      <defs>
        <radialGradient id="tc-core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={COLORS.isro} stopOpacity="0.55" />
          <stop offset="70%" stopColor={COLORS.isro} stopOpacity="0.08" />
          <stop offset="100%" stopColor={COLORS.isro} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* faint core glow */}
      {showCenter && <circle cx={cx} cy={cy} r={r * 0.95} fill="url(#tc-core)" />}

      {/* the ring */}
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={COLORS.line}
        strokeWidth={Math.max(1, size * 0.006)}
      />

      {/* travelling saffron pulse along the ring */}
      <motion.circle
        r={nodeR * 0.6}
        fill={COLORS.saffron}
        style={{ filter: 'drop-shadow(0 0 6px rgba(255,138,61,0.9))' }}
        initial={{ cx: points[0].x, cy: points[0].y }}
        animate={{
          cx: points.map((p) => p.x).concat(points[0].x),
          cy: points.map((p) => p.y).concat(points[0].y),
        }}
        transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
      />

      {/* nodes */}
      {points.map((p) => {
        const flaring = !!flares[p.stage]
        return (
          <g key={p.stage}>
            <motion.circle
              cx={p.x}
              cy={p.y}
              r={nodeR}
              fill={flaring ? COLORS.saffron : COLORS.panel2}
              stroke={flaring ? COLORS.saffron : COLORS.isro}
              strokeWidth={Math.max(1, size * 0.005)}
              animate={
                flaring
                  ? { scale: [1, 1.9, 1], opacity: [1, 1, 0.9] }
                  : { scale: 1, opacity: 0.9 }
              }
              transition={{ duration: 1, ease: 'easeOut' }}
              style={{ transformOrigin: `${p.x}px ${p.y}px` }}
            />
            {showLabels && (
              <text
                x={p.x + (p.x < cx ? -1 : 1) * nodeR * 1.8 * (Math.abs(p.x - cx) < 4 ? 0 : 1)}
                y={p.y + (p.y < cy ? -nodeR * 1.8 : nodeR * 2.6)}
                fill={flaring ? COLORS.saffron : COLORS.muted}
                fontSize={Math.max(7, size * 0.034)}
                fontFamily="JetBrains Mono, monospace"
                textAnchor="middle"
                style={{ letterSpacing: '0.05em' }}
              >
                {p.stage}
              </text>
            )}
          </g>
        )
      })}

      {/* center sync gauge */}
      {showCenter && (
        <g>
          <text
            x={cx}
            y={cy - size * 0.02}
            fill={COLORS.ink}
            fontSize={Math.max(9, size * 0.05)}
            fontFamily="JetBrains Mono, monospace"
            textAnchor="middle"
            style={{ letterSpacing: '0.08em' }}
          >
            REALITY⟷TWIN
          </text>
          <text
            x={cx}
            y={cy + size * 0.06}
            fill={COLORS.online}
            fontSize={Math.max(11, size * 0.075)}
            fontFamily="JetBrains Mono, monospace"
            fontWeight={700}
            textAnchor="middle"
          >
            SYNC
          </text>
        </g>
      )}
    </svg>
  )
}
