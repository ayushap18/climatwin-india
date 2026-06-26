// CommandPalette.tsx — a ⌘K / Ctrl-K fuzzy command palette: jump to any view, switch model
// or variable, flip the theme. Keyboard-driven (↑/↓/Enter/Esc). Pure React state.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppDispatch, useAppState, type ViewId } from '../../state/useAppState'
import type { VarName } from '../../api/types'

interface Cmd {
  id: string
  label: string
  hint: string
  group: string
  run: () => void
}

const VIEWS: { id: ViewId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'twin', label: 'Digital Twin' },
  { id: 'explore', label: 'Explore Map' },
  { id: 'whatif', label: 'What-If' },
  { id: 'validation', label: 'Validation' },
  { id: 'downscale', label: 'Downscale' },
]
const VARS: VarName[] = ['rainfall', 'tmax', 'tmin']

export default function CommandPalette() {
  const { meta, theme } = useAppState()
  const dispatch = useAppDispatch()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // global ⌘K / Ctrl-K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      } else if (e.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) {
      setQ('')
      setSel(0)
      setTimeout(() => inputRef.current?.focus(), 10)
    }
  }, [open])

  const commands = useMemo<Cmd[]>(() => {
    const close = () => setOpen(false)
    const list: Cmd[] = []
    for (const v of VIEWS)
      list.push({ id: `view:${v.id}`, label: `Go to ${v.label}`, hint: 'view', group: 'Navigate',
        run: () => { dispatch({ type: 'SET_VIEW', view: v.id }); close() } })
    for (const m of meta?.models ?? [])
      list.push({ id: `model:${m}`, label: `Model · ${m.toUpperCase()}`, hint: 'forecaster', group: 'Model',
        run: () => { dispatch({ type: 'SET_MODEL', model: m }); close() } })
    for (const vr of VARS)
      list.push({ id: `var:${vr}`, label: `Variable · ${vr.toUpperCase()}`, hint: 'layer', group: 'Variable',
        run: () => { dispatch({ type: 'SET_VARIABLE', variable: vr }); close() } })
    list.push({ id: 'theme', label: `Theme · switch to ${theme === 'dark' ? 'light' : 'dark'}`, hint: 'appearance', group: 'View',
      run: () => { dispatch({ type: 'SET_THEME', theme: theme === 'dark' ? 'light' : 'dark' }); close() } })
    return list
  }, [meta?.models, theme, dispatch])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return commands
    return commands.filter((c) => (c.label + ' ' + c.group).toLowerCase().includes(s))
  }, [q, commands])

  useEffect(() => setSel(0), [q])
  if (!open) return null

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(filtered.length - 1, s + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(0, s - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); filtered[sel]?.run() }
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-start justify-center bg-black/50 backdrop-blur-sm pt-[12vh]"
      onClick={() => setOpen(false)}>
      <div
        className="w-[min(560px,92vw)] overflow-hidden rounded-xl border border-line bg-panel/95 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Jump to a view, model, variable…  (Esc to close)"
          className="w-full border-b border-line bg-transparent px-4 py-3 font-mono text-[13px] text-ink outline-none placeholder:text-muted/50"
        />
        <div className="max-h-[46vh] overflow-y-auto py-1">
          {filtered.length === 0 && (
            <div className="px-4 py-4 text-center font-mono text-[11px] text-muted">no matches</div>
          )}
          {filtered.map((c, i) => (
            <button
              key={c.id}
              onMouseEnter={() => setSel(i)}
              onClick={() => c.run()}
              className={`flex w-full items-center justify-between px-4 py-2 text-left font-mono text-[12px] transition-colors ${
                i === sel ? 'bg-isro/15 text-ink' : 'text-muted hover:text-ink'
              }`}
            >
              <span>
                <span className="mr-2 text-[9px] uppercase tracking-[0.12em] text-isro/70">{c.group}</span>
                {c.label}
              </span>
              <span className="text-[9px] text-muted/60">{c.hint}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 border-t border-line px-4 py-1.5 font-mono text-[9px] text-muted/60">
          <span>↑↓ navigate</span><span>↵ select</span><span>esc close</span>
          <span className="ml-auto text-saffron/70">⌘K</span>
        </div>
      </div>
    </div>
  )
}
