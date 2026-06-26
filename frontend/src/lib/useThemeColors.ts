// useThemeColors.ts — resolve the themeable palette (which lives in CSS variables) into
// concrete rgb() strings for inline SVG / recharts usage, recomputed when the theme flips.
// Accent colors are theme-independent and returned as-is.

import { useEffect, useState } from 'react'
import { useAppState } from '../state/useAppState'

export interface ThemeColors {
  bg: string
  panel: string
  panel2: string
  line: string
  ink: string
  muted: string
  isro: string
  saffron: string
  online: string
  danger: string
}

function readVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v ? `rgb(${v})` : fallback
}

function compute(): ThemeColors {
  return {
    bg: readVar('--bg', '#04050a'),
    panel: readVar('--panel', '#090b11'),
    panel2: readVar('--panel-2', '#0f1119'),
    line: readVar('--line', '#1a1e2a'),
    ink: readVar('--ink', '#e8eefc'),
    muted: readVar('--muted', '#7e8aa6'),
    isro: '#3a78ff',
    saffron: '#ff8a3d',
    online: '#36d399',
    danger: '#ff5470',
  }
}

export function useThemeColors(): ThemeColors {
  const { theme } = useAppState()
  const [colors, setColors] = useState<ThemeColors>(() => compute())
  useEffect(() => {
    // recompute after the DOM attribute has switched
    const id = requestAnimationFrame(() => setColors(compute()))
    return () => cancelAnimationFrame(id)
  }, [theme])
  return colors
}
