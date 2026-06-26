// api/types.ts — TypeScript mirrors of the verified backend contract (backend/app.py).
// Optional fields encode the degraded-env reality: this deployment serves the
// synthetic cube with only persistence/climatology, no downscale, no MC-dropout std.

export type VarName = 'rainfall' | 'tmax' | 'tmin'

export interface Health {
  status: string
  data_source: string
  dates: [string, string]
  region: string
}

export interface BBox {
  lon_min: number
  lat_min: number
  lon_max: number
  lat_max: number
}

export interface Meta {
  region: string
  bbox: BBox
  res_deg: number
  grid: { lat: number[]; lon: number[]; shape: [number, number] }
  variables: VarName[]
  units: Record<string, string>
  colorbar_ranges: Record<VarName, [number, number]>
  dates: { start: string; end: string; count: number }
  latest_date: string
  split: Record<string, [number, number]>
  models: string[]
  default_model: string
  data_source: string
  data_source_note: string
  lst_source: string | null
  has_lst: boolean
  downscale_available: boolean
  max_horizon: number
  thresholds: {
    wet_day_mm: number
    heat_stress_tmax_c: number
    sowing_onset_mm: number
  }
}

export type Fields = Record<VarName, number[][]>

export interface Impacts {
  dryness_index: number
  heat_stress_fraction: number
  heat_stress_map: number[][]
  mean_rainfall_mm: number
  max_tmax_c: number
  wet_cell_fraction: number
}

export interface StateResp {
  date: string
  data_source: string
  lat: number[]
  lon: number[]
  units: Record<string, string>
  fields: Fields
  impacts: Impacts
}

export interface SowingWindow {
  sowing_ok: boolean
  onset_lead_day: number | null
  accumulated_rain_mm: number
  threshold_mm: number
}

export interface ForecastDay {
  lead_day: number
  date: string
  fields: Fields
  std?: Fields // present only for ConvLSTM MC-dropout (absent here)
  impacts: Impacts
}

export interface ForecastResp {
  init_date: string
  model: string
  horizon: number
  data_source: string
  lat: number[]
  lon: number[]
  units: Record<string, string>
  days: ForecastDay[]
  sowing_window: SowingWindow
  uncertainty?: boolean
  n_samples?: number
  uncertainty_method?: string
  uncertainty_note?: string
}
