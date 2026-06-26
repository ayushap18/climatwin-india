// InfoPopover.tsx — a small "?" affordance that reveals a short explanatory note on hover
// or focus. Pure CSS/React, no portal; positions above-right of the trigger.

import { useState, type ReactNode } from 'react'

export default function InfoPopover({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="grid h-3.5 w-3.5 place-items-center rounded-full border border-line text-[8px] text-muted hover:border-isro/50 hover:text-ink"
        aria-label="more info"
      >
        ?
      </button>
      {open && (
        <span className="absolute bottom-5 right-0 z-30 w-56 rounded-md border border-line bg-panel px-2.5 py-2 text-left font-mono text-[10px] leading-relaxed text-muted shadow-glow">
          {children}
        </span>
      )}
    </span>
  )
}
