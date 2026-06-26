// StubView.tsx — placeholder for the views that land in later milestones (M2–M6).
// Keeps NavRail routing fully wired now; states honestly what's coming.

import { motion } from 'framer-motion'

export default function StubView({
  title,
  milestone,
  blurb,
}: {
  title: string
  milestone: string
  blurb: string
}) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md rounded-xl border border-line bg-panel/40 p-8 text-center"
      >
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-lg border border-isro/40 bg-panel-2 font-mono text-saffron shadow-glow">
          {milestone}
        </div>
        <h2 className="font-mono text-lg tracking-[0.18em] text-ink">{title}</h2>
        <p className="mt-3 font-mono text-xs leading-relaxed text-muted">{blurb}</p>
        <div className="mt-5 inline-block rounded-full border border-line px-3 py-1 font-mono text-[10px] tracking-[0.2em] text-muted">
          ARRIVING IN {milestone}
        </div>
      </motion.div>
    </div>
  )
}
