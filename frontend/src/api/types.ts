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
  diffusion_available: boolean
  diffusion_metrics: DiffusionMetrics | null
  highres_available: boolean
  highres_res: number | null
  highres_vars: VarName[]
  highres_shape: [number, number] | null
  max_horizon: number
  thresholds: {
    wet_day_mm: number
    heat_stress_tmax_c: number
    sowing_onset_mm: number
  }
}

export interface HighresResp {
  date: string
  var: VarName
  data_source: string
  res_deg: number
  lat: number[]
  lon: number[]
  shape: [number, number]
  unit: string
  field: number[][]
  range: [number, number]
  note: string
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
  analogs?: AnalogMatch[] // present only for the analog (k-NN) model
}

export interface AnalogMatch {
  date: string
  distance: number
}

export interface WhatIfParams {
  date?: string
  horizon?: number
  delta_temp?: number
  rain_factor?: number
  urban_polygon?: [number, number][] // [[lat,lon],...]
  urban_lst?: number
  model?: string
}

export interface WhatIfDay {
  lead_day: number
  date: string
  baseline: Fields
  scenario: Fields
  diff: Fields
  impacts_baseline: Impacts
  impacts_scenario: Impacts
}

export interface WhatIfResp {
  init_date: string
  model: string
  horizon: number
  scenario_params: {
    delta_temp: number
    rain_factor: number
    urban_lst: number
    urban_cells: number
  }
  data_source: string
  lat: number[]
  lon: number[]
  units: Record<string, string>
  days: WhatIfDay[]
  sowing_baseline: SowingWindow
  sowing_scenario: SowingWindow
}

export interface AiResp {
  question: string
  intent: string
  provider: string
  used: string[]
  answer: string
  data: unknown
}

// --- agentic brain ----------------------------------------------------------
// Brain stages: the five twin-loop stages + SKILL (validation) + IMPACT (decision)
// + REFUSE (out-of-scope). SKILL/REFUSE map onto the 5-stage TwinCore bus client-side.
export type BrainStage =
  | 'MIRROR'
  | 'ASSIMILATE'
  | 'SIMULATE'
  | 'PERTURB'
  | 'SKILL'
  | 'IMPACT'
  | 'REFUSE'

export interface BrainStep {
  stage: BrainStage
  label: string
  tool: string | null
  status: 'pending' | 'ok' | 'error'
  citation: string | null
}

export interface BrainResp {
  question: string
  intent: string
  plan: BrainStep[]
  facts: Record<string, unknown>
  answer: string
  citations: string[]
  caveat: string
  refused: boolean
  provider: string
}

export interface AnomalyResp {
  anomaly: boolean
  kind: 'heat' | 'dryness' | null
  date: string
  value?: number
  threshold?: number
  baseline?: string
  message: string
  suggested_question: string | null
}

export interface TwinDay {
  lead_day: number
  date: string
  twin: Fields
  impacts_twin: Impacts
  reality: Fields | null
  divergence: Record<VarName, number> | null
  sync_pct: number | null
  impacts_reality?: Impacts
}

export interface TwinRunResp {
  anchor_date: string
  model: string
  horizon: number
  assimilate: boolean
  data_source: string
  lat: number[]
  lon: number[]
  units: Record<string, string>
  sync_ref_tmax_c: number
  days: TwinDay[]
}

export interface CategoricalMetrics {
  POD: number
  FAR: number
  CSI: number
  hits: number
  misses: number
  false_alarms: number
}

export interface VarMetrics {
  RMSE: number
  MAE: number
  corr: number
  categorical?: CategoricalMetrics
}

export interface ModelMetrics {
  rainfall: VarMetrics
  tmax: VarMetrics
  tmin: VarMetrics
  error_map_tmax_rmse: number[][]
}

export interface ValidateResp {
  data_source: string
  split: Record<string, [number, number]>
  wet_day_threshold_mm: number
  note: string
  lat: number[]
  lon: number[]
  horizons: Record<string, Record<string, ModelMetrics>>
  // summary_rmse[horizon][var] = { `${model}_RMSE`: number, best: string }
  summary_rmse: Record<string, Record<string, Record<string, number | string>>>
  models: string[]
  calibration?: {
    alpha: number
    target: number
    coverage: Record<VarName, Record<string, number>>
    coverage_split?: 'test' | 'calib'
    halfwidth: Record<VarName, Record<string, number>>
    split: { fit_years: [number, number]; calib_years: [number, number]; test_years?: [number, number] }
  }
}

export interface DiffusionMetrics {
  bilinear_rmse: number
  diffusion_rmse: number
  crps: number
  fss_bilinear: number
  fss_diffusion: number
  spec_bilinear: number
  spec_diffusion: number
  threshold_mm: number
  n_samples: number
  n_days: number
  data_source: string
}

export interface DiffusionResp {
  date: string
  var: string
  res_deg: number
  samples: number
  lat: number[]
  lon: number[]
  shape: [number, number]
  range: [number, number]
  unit: string
  bilinear: number[][]
  mean: number[][]
  std: number[][]
  truth: number[][]
  metrics: DiffusionMetrics | null
  note: string
}

export interface DownscaleResp {
  var: string
  date: string
  downscale_var: string
  factor: number
  lat: number[]
  lon: number[]
  coarse: number[][]
  bilinear: number[][]
  srcnn: number[][]
  bilinear_rmse: number | null
  srcnn_rmse: number | null
  improvement_pct: number | null
  data_source: string
}
