// MosdacBasemap.tsx — an offline, MOSDAC-style cartographic basemap for the insat_real
// regime. A self-contained Leaflet child (no external tile servers, no network beyond the
// bundled india-adm1.geojson — the demo runs offline). Layers, bottom-up:
//   1. a satellite-grey land fill + thin professional-blue ADM1 boundaries,
//   2. a lat/lon graticule computed live from the map view, with edge tick labels,
//   3. a subtle radial vignette + faint scanline sheen evoking a satellite product frame.
// Drop it in as the FIRST child of <MapContainer> (under the data grid), e.g. inside
// DarkIndiaMap's body or a sibling map shell. It never intercepts clicks and is theme-aware,
// mirroring DarkIndiaMap's offline styling.

import 'leaflet/dist/leaflet.css'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { GeoJSON, Polyline, useMap } from 'react-leaflet'
import type { PathOptions } from 'leaflet'
import { loadIndiaAdm1, type IndiaFC } from '../../lib/geojson'
import { useThemeColors } from '../../lib/useThemeColors'
import { useAppState } from '../../state/useAppState'

// Satellite-grey land + professional-blue outlines. Tuned per theme so the same vectors
// read on a near-black mission console and on a pale print.
const BASE_STYLE: Record<'dark' | 'light', PathOptions> = {
  dark: {
    color: '#3a78ff',
    weight: 1,
    opacity: 0.7,
    fill: true,
    fillColor: '#0c121b', // satellite-grey land on near-black ocean
    fillOpacity: 0.55,
    interactive: false,
  },
  light: {
    color: '#3a78ff',
    weight: 1,
    opacity: 0.85,
    fill: true,
    fillColor: '#e6ebf2',
    fillOpacity: 0.6,
    interactive: false,
  },
}

// Choose a "nice" graticule spacing (degrees) so the visible span shows ~6 lines.
function niceStep(span: number): number {
  const steps = [10, 5, 2, 1, 0.5, 0.25, 0.1, 0.05]
  const target = span / 6
  for (const s of steps) if (s <= target) return s
  return steps[steps.length - 1]
}

// Multiples of `step` that fall within [lo, hi], snapped to the step grid.
function ticks(lo: number, hi: number, step: number): number[] {
  const out: number[] = []
  const start = Math.ceil(lo / step) * step
  for (let v = start; v <= hi + 1e-9; v += step) out.push(Math.round(v / step) * step)
  return out
}

function decimals(step: number): number {
  return step < 0.1 ? 2 : step < 1 ? 1 : 0
}
function fmtLat(v: number, dp: number): string {
  return `${Math.abs(v).toFixed(dp)}°${v >= 0 ? 'N' : 'S'}`
}
function fmtLon(v: number, dp: number): string {
  return `${Math.abs(v).toFixed(dp)}°${v >= 0 ? 'E' : 'W'}`
}

export default function MosdacBasemap() {
  const map = useMap()
  const c = useThemeColors()
  const { theme } = useAppState()
  const [india, setIndia] = useState<IndiaFC | null>(null)
  // bump on any view change so the graticule + projected labels recompute live
  const [, setTick] = useState(0)

  useEffect(() => {
    let on = true
    loadIndiaAdm1()
      .then((fc) => on && setIndia(fc))
      .catch(() => on && setIndia(null))
    return () => {
      on = false
    }
  }, [])

  useEffect(() => {
    const redraw = () => setTick((t) => t + 1)
    map.on('move zoom viewreset resize', redraw)
    return () => {
      map.off('move zoom viewreset resize', redraw)
    }
  }, [map])

  // Live view extent -> graticule lines.
  const b = map.getBounds()
  const south = b.getSouth()
  const north = b.getNorth()
  const west = b.getWest()
  const east = b.getEast()
  const latStep = niceStep(north - south)
  const lonStep = niceStep(east - west)
  const latTicks = ticks(south, north, latStep)
  const lonTicks = ticks(west, east, lonStep)
  const latDp = decimals(latStep)
  const lonDp = decimals(lonStep)

  const gridStyle: PathOptions = {
    color: c.isro,
    weight: 0.5,
    opacity: theme === 'dark' ? 0.22 : 0.3,
    dashArray: '2 6',
    interactive: false,
  }

  // Project ticks to screen for edge labels (recomputed each render via setTick).
  const size = map.getSize()
  const latLabels = latTicks.map((lat) => ({
    text: fmtLat(lat, latDp),
    y: map.latLngToContainerPoint([lat, west]).y,
  }))
  const lonLabels = lonTicks.map((lon) => ({
    text: fmtLon(lon, lonDp),
    x: map.latLngToContainerPoint([south, lon]).x,
  }))

  const container = map.getContainer()
  const edge = theme === 'dark' ? '#03060d' : '#9fb0cc'

  return (
    <>
      {india && (
        <GeoJSON
          key={theme} // restyle on theme flip
          data={india as unknown as GeoJSON.GeoJsonObject}
          style={() => BASE_STYLE[theme]}
        />
      )}

      {latTicks.map((lat) => (
        <Polyline
          key={`la${lat}`}
          positions={[
            [lat, west],
            [lat, east],
          ]}
          pathOptions={gridStyle}
        />
      ))}
      {lonTicks.map((lon) => (
        <Polyline
          key={`lo${lon}`}
          positions={[
            [south, lon],
            [north, lon],
          ]}
          pathOptions={gridStyle}
        />
      ))}

      {/* Fixed-to-viewport satellite-frame overlay: vignette + scanlines + graticule labels.
          Portaled into the map container so it stays put during pan/zoom; pointer-events none
          so it never steals clicks from the data grid below. */}
      {createPortal(
        <div
          className="leaflet-pane"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 410,
            pointerEvents: 'none',
            overflow: 'hidden',
          }}
          aria-hidden
        >
          {/* radial vignette — clear center, darkened corners (satellite product framing) */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: `radial-gradient(120% 120% at 50% 45%, transparent 55%, ${edge} 100%)`,
              opacity: theme === 'dark' ? 0.7 : 0.45,
            }}
          />
          {/* faint horizontal scanlines */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: `repeating-linear-gradient(0deg, ${c.ink} 0px, ${c.ink} 1px, transparent 1px, transparent 3px)`,
              opacity: theme === 'dark' ? 0.035 : 0.02,
              mixBlendMode: 'overlay',
            }}
          />
          {/* corner registration ticks */}
          {(
            [
              [2, 2, true, true],
              [size.x - 14, 2, false, true],
              [2, size.y - 14, true, false],
              [size.x - 14, size.y - 14, false, false],
            ] as const
          ).map(([x, y, left, top], i) => (
            <svg
              key={i}
              width={12}
              height={12}
              style={{ position: 'absolute', left: x, top: y }}
            >
              <path
                d={`M ${left ? 0 : 12} ${top ? 11 : 1} L ${left ? 0 : 12} ${top ? 1 : 11} L ${left ? 11 : 1} ${top ? 1 : 11}`}
                fill="none"
                stroke={c.isro}
                strokeWidth={1}
                strokeOpacity={0.55}
              />
            </svg>
          ))}
          {/* latitude labels along the left edge */}
          {latLabels.map((l) => (
            <span
              key={`la${l.text}`}
              style={{
                position: 'absolute',
                left: 5,
                top: Math.max(2, Math.min(size.y - 12, l.y - 6)),
                font: '600 9px ui-monospace, SFMono-Regular, Menlo, monospace',
                letterSpacing: '0.06em',
                color: c.muted,
                textShadow: `0 0 3px ${edge}`,
              }}
            >
              {l.text}
            </span>
          ))}
          {/* longitude labels along the bottom edge */}
          {lonLabels.map((l) => (
            <span
              key={`lo${l.text}`}
              style={{
                position: 'absolute',
                left: Math.max(2, Math.min(size.x - 36, l.x - 16)),
                bottom: 4,
                font: '600 9px ui-monospace, SFMono-Regular, Menlo, monospace',
                letterSpacing: '0.06em',
                color: c.muted,
                textShadow: `0 0 3px ${edge}`,
              }}
            >
              {l.text}
            </span>
          ))}
          {/* product tag, MOSDAC-style */}
          <span
            style={{
              position: 'absolute',
              right: 8,
              top: 6,
              font: '700 8px ui-monospace, SFMono-Regular, Menlo, monospace',
              letterSpacing: '0.22em',
              color: c.muted,
              opacity: 0.8,
            }}
          >
            MOSDAC · OFFLINE
          </span>
        </div>,
        container,
      )}
    </>
  )
}
