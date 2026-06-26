// exportPng.ts — capture a DOM node (e.g. the active view's <main>) to a branded PNG.
// SVG-based views (Explore/Validation/Downscale) capture cleanly; the WebGL globe on
// Overview may render blank (acceptable — export from a data view for the deck).

import { toPng } from 'html-to-image'

export async function exportNodePng(node: HTMLElement | null, filename = 'climatwin.png'): Promise<void> {
  if (!node) return
  const bg = getComputedStyle(document.body).backgroundColor || '#04050a'
  const url = await toPng(node, { cacheBust: true, pixelRatio: 2, backgroundColor: bg })
  const a = document.createElement('a')
  a.download = filename
  a.href = url
  a.click()
}
