// Skeleton.tsx — a shimmering placeholder block for loading states (see .ct-skeleton in
// index.css). Use instead of bare "loading…" text so panels reserve their shape.

export default function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`ct-skeleton rounded-md ${className}`} />
}

/** A grid of skeleton tiles — a stand-in for a map/field while it loads. */
export function SkeletonGrid({ rows = 6, cols = 8 }: { rows?: number; cols?: number }) {
  return (
    <div className="grid h-full w-full gap-1 p-4" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {Array.from({ length: rows * cols }).map((_, i) => (
        <div key={i} className="ct-skeleton rounded" style={{ aspectRatio: '1' }} />
      ))}
    </div>
  )
}
