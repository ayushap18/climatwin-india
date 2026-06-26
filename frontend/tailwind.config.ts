import type { Config } from 'tailwindcss'

// Palette + glow tokens mirror src/theme.ts (single source of truth there; these
// names let us use them as Tailwind utilities like bg-panel, text-saffron, shadow-glow).
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // themeable (switch via :root[data-theme])
        bg: 'rgb(var(--bg) / <alpha-value>)',
        panel: 'rgb(var(--panel) / <alpha-value>)',
        'panel-2': 'rgb(var(--panel-2) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        // accents (theme-independent)
        isro: '#3a78ff',
        saffron: '#ff8a3d',
        online: '#36d399',
        danger: '#ff5470',
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(58,120,255,0.16), 0 0 18px -6px rgba(58,120,255,0.3)',
        'glow-saffron': '0 0 0 1px rgba(255,138,61,0.25), 0 0 20px -6px rgba(255,138,61,0.4)',
        'glow-soft': '0 0 28px -10px rgba(58,120,255,0.22)',
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
