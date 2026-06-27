// GuideAssistant.tsx — an always-on, context-aware helper. It watches the current screen
// (active view / variable / model / date) and explains, in plain language, what the user is
// looking at — auto-updating as they navigate — plus a box to ask a simple question. Talks to
// /guide (offline-first; friendlier prose if a fine-tuned local model is configured).

import { useEffect, useRef, useState } from 'react'
import { getGuide } from '../../api/endpoints'
import type { GuideResp } from '../../api/types'
import { useAppState } from '../../state/useAppState'

export default function GuideAssistant() {
  const { activeView, activeVariable, model } = useAppState()
  const [open, setOpen] = useState(false)
  const [ctx, setCtx] = useState<GuideResp | null>(null)
  const [q, setQ] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  // watch the screen: refetch the contextual explanation whenever the view/variable changes
  useEffect(() => {
    let on = true
    getGuide({ view: activeView, variable: activeVariable, model: model ?? undefined })
      .then((g) => on && setCtx(g))
      .catch(() => {})
    setAnswer(null)
    return () => {
      on = false
    }
  }, [activeView, activeVariable, model])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [answer, ctx])

  async function ask() {
    const question = q.trim()
    if (!question) return
    setBusy(true)
    setAnswer(null)
    try {
      const g = await getGuide({ view: activeView, variable: activeVariable, model: model ?? undefined, q: question })
      // the guide is for non-experts — strip the [tool:field] grounding tokens so the
      // answer reads as clean, plain prose (the brain console keeps them as footnotes).
      const clean = (g.answer ?? g.plain ?? '').replace(/\s*\[[^\]]+\]/g, '').replace(/\s{2,}/g, ' ').trim()
      setAnswer(clean || "I don't have data for that one — try asking about rainfall, temperature, or a date.")
    } catch {
      setAnswer("I couldn't reach the guide just now.")
    } finally {
      setBusy(false)
      setQ('')
    }
  }

  return (
    <>
      {/* floating launcher (always visible, above the console bar) */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          title="Need help? Ask the guide"
          className="fixed bottom-16 right-4 z-[700] flex items-center gap-2 rounded-full border border-isro/50 bg-panel/95 px-3 py-2 font-mono text-[11px] text-ink shadow-glow backdrop-blur-md transition-transform hover:scale-105"
        >
          <span className="grid h-5 w-5 place-items-center rounded-full bg-isro/20 text-saffron">✦</span>
          <span className="tracking-[0.1em]">GUIDE</span>
        </button>
      )}

      {open && (
        <div className="fixed bottom-16 right-4 z-[700] flex w-[min(330px,92vw)] flex-col rounded-xl border border-isro/40 bg-panel/97 shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.14em] text-ink">
              <span className="text-saffron">✦</span> GUIDE
              <span className="flex items-center gap-1 text-[8px] text-muted/60">
                <span className="h-1.5 w-1.5 rounded-full bg-online" />
                {ctx?.provider?.startsWith('grounded') ? 'READY' : 'AI'}
              </span>
            </div>
            <button onClick={() => setOpen(false)} className="font-mono text-[11px] text-muted hover:text-danger">✕</button>
          </div>

          <div ref={scrollRef} className="max-h-[44vh] overflow-y-auto px-3 py-2.5 text-[12px] leading-relaxed">
            <p className="text-ink/90">{ctx?.plain ?? 'Looking at your screen…'}</p>
            {answer && (
              <div className="mt-2 rounded-md border border-saffron/30 bg-saffron/5 px-2.5 py-2 text-ink/90">
                {answer}
              </div>
            )}
            {!answer && ctx?.tips?.length ? (
              <div className="mt-2 space-y-1">
                {ctx.tips.map((t) => (
                  <div key={t} className="flex items-start gap-1.5 font-mono text-[10px] text-muted">
                    <span className="text-isro">›</span> {t}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-2 border-t border-line px-3 py-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && ask()}
              placeholder="ask me anything, simply…"
              className="flex-1 bg-transparent font-mono text-[12px] text-ink outline-none placeholder:text-muted/40"
            />
            <button
              onClick={ask}
              disabled={busy}
              className="rounded-md border border-isro/50 bg-isro/10 px-2 py-1 font-mono text-[10px] text-ink hover:bg-isro/20 disabled:opacity-50"
            >
              {busy ? '…' : 'ASK'}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
