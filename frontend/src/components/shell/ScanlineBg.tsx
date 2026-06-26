// ScanlineBg.tsx — fixed full-screen ambient background: a faint dot grid + a slow
// scanline sweep. Pure CSS, GPU-cheap, sits behind everything (z-0, pointer-events-none).

export default function ScanlineBg() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-bg">
      {/* dot grid — dim + near-neutral so the look reads blackish, not blue */}
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            'radial-gradient(rgba(120,140,180,0.06) 1px, transparent 1px)',
          backgroundSize: '26px 26px',
        }}
      />
      {/* faint radial vignette toward center */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at 50% 28%, rgba(58,120,255,0.035), transparent 62%)',
        }}
      />
      {/* moving scanline */}
      <div
        className="absolute inset-x-0 h-24 animate-scan opacity-[0.04]"
        style={{
          background:
            'linear-gradient(180deg, transparent, rgba(120,140,180,0.6), transparent)',
        }}
      />
    </div>
  )
}
