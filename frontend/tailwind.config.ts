import type { Config } from 'tailwindcss'

// Palette + glow tokens mirror src/theme.ts (single source of truth there; these
// names let us use them as Tailwind utilities like bg-panel, text-saffron, shadow-glow).
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#05070d',
        panel: '#0b1020',
        'panel-2': '#0e1428',
        line: '#1b2742',
        isro: '#2b6cff',
        saffron: '#ff8a3d',
        ink: '#e8f0ff',
        muted: '#8aa0c8',
        online: '#36d399',
        danger: '#ff5470',
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(43,108,255,0.25), 0 0 24px -4px rgba(43,108,255,0.45)',
        'glow-saffron': '0 0 0 1px rgba(255,138,61,0.3), 0 0 24px -4px rgba(255,138,61,0.5)',
        'glow-soft': '0 0 32px -8px rgba(43,108,255,0.35)',
      },
      keyframes: {
        'pulse-dot': {
          '0%,100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.4', transform: 'scale(0.82)' },
        },
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
      },
      animation: {
        'pulse-dot': 'pulse-dot 1.8s ease-in-out infinite',
        scan: 'scan 7s linear infinite',
      },
    },
  },
  plugins: [],
} satisfies Config
