// lib/grid.ts — turn the backend's regular lat/lon grid into per-cell rectangles.
// A field is a [nlat][nlon] array; field[i][j] sits at (lat[i], lon[j]), lat ascending
// S->N, lon ascending W->E. Each cell spans ±res/2 around its center. Fields can come
// from /state (observed) or any /forecast day, so these take raw arrays, not a response.

export type LatLngBounds = [[number, number], [number, number]] // [[south,west],[north,east]]

export interface Cell {
  i: number
  j: number
  lat: number
  lon: number
  bounds: LatLngBounds
  value: number
}

/** Bounds for a single cell centered at (lat,lon) with grid resolution `res`. */
export function cellBounds(lat: number, lon: number, res: number): LatLngBounds {
  const h = res / 2
  return [
    [lat - h, lon - h],
    [lat + h, lon + h],
  ]
}

/** Every cell of `field` (a [nlat][nlon] array) with value + leaflet bounds. */
export function cellsFor(
  field: number[][],
  lat: number[],
  lon: number[],
  res: number,
): Cell[] {
  const cells: Cell[] = []
  for (let i = 0; i < lat.length; i++) {
    for (let j = 0; j < lon.length; j++) {
      cells.push({
        i,
        j,
        lat: lat[i],
        lon: lon[j],
        bounds: cellBounds(lat[i], lon[j], res),
        value: field[i]?.[j] ?? NaN,
      })
    }
  }
  return cells
}

/** Outer bounds of the whole grid (for fitting the map view). */
export function gridBounds(lat: number[], lon: number[], res: number): LatLngBounds {
  const h = res / 2
  return [
    [lat[0] - h, lon[0] - h],
    [lat[lat.length - 1] + h, lon[lon.length - 1] + h],
  ]
}
