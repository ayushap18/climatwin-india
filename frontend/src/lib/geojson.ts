// lib/geojson.ts — load the bundled, simplified India ADM1 outline (offline, from
// public/data). Module-level promise cache so it's fetched at most once per session.

export interface IndiaFeature {
  type: 'Feature'
  properties: { name: string }
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
}
export interface IndiaFC {
  type: 'FeatureCollection'
  features: IndiaFeature[]
}

let cached: Promise<IndiaFC> | null = null

export function loadIndiaAdm1(): Promise<IndiaFC> {
  if (!cached) {
    cached = fetch('/data/india-adm1.geojson').then((r) => {
      if (!r.ok) throw new Error(`india-adm1.geojson ${r.status}`)
      return r.json() as Promise<IndiaFC>
    })
  }
  return cached
}
