// ScanlineBg.tsx — fixed full-screen ambient background: a faint dot grid + a slow
// scanline sweep. Pure CSS, GPU-cheap, sits behind everything (z-0, pointer-events-none).

export default function ScanlineBg() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-bg">
      {/* dot grid */}
      <div
        className="absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage:
            'radial-gradient(rgba(43,108,255,0.10) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />
      {/* radial vignette toward center */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at 50% 30%, rgba(43,108,255,0.06), transparent 60%)',
        }}
      />
      {/* moving scanline */}
      <div
        className="absolute inset-x-0 h-24 animate-scan opacity-[0.06]"
        style={{
          background:
            'linear-gradient(180deg, transparent, rgba(43,108,255,0.8), transparent)',
        }}
      />
    </div>
  )
}
