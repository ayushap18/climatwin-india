// state/AppContext.tsx — global app state via Context + useReducer (no state lib, no
// web storage). Bootstraps the twin on mount: parallel /health + /meta gate the Splash,
// then prefetch the latest /state and the default /forecast so the Overview is alive.

import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react'
import { getForecast, getHealth, getMeta, getState } from '../api/endpoints'
import type { ForecastResp, Health, Meta, StateResp, VarName } from '../api/types'

export type ViewId = 'overview' | 'twin' | 'explore' | 'whatif' | 'validation' | 'downscale'
export type BootStatus = 'booting' | 'ready' | 'error'

export interface AppState {
  bootStatus: BootStatus
  bootError: string | null
  health: Health | null
  meta: Meta | null
  state: StateResp | null
  forecast: ForecastResp | null
  activeView: ViewId
  activeVariable: VarName
  model: string | null
  initDate: string | null
  horizon: number
  timelineIndex: number
  playing: boolean
  uncertainty: boolean
  selectedCell: { row: number; col: number } | null
  gridContrast: number // 0.4..2.5, applied to all heatmap colormaps (1 = neutral)
  globeSpin: boolean
  theme: 'dark' | 'light'
}

const initialState: AppState = {
  bootStatus: 'booting',
  bootError: null,
  health: null,
  meta: null,
  state: null,
  forecast: null,
  activeView: 'overview',
  activeVariable: 'tmax',
  model: null,
  initDate: null,
  horizon: 7,
  timelineIndex: 0,
  playing: false,
  uncertainty: false,
  selectedCell: null,
  gridContrast: 1,
  globeSpin: true,
  theme: 'dark',
}

type Action =
  | { type: 'BOOT_READY'; health: Health; meta: Meta }
  | { type: 'BOOT_ERROR'; error: string }
  | { type: 'SET_STATE'; state: StateResp }
  | { type: 'SET_FORECAST'; forecast: ForecastResp }
  | { type: 'SET_VIEW'; view: ViewId }
  | { type: 'SET_VARIABLE'; variable: VarName }
  | { type: 'SET_MODEL'; model: string }
  | { type: 'SET_HORIZON'; horizon: number }
  | { type: 'SET_TIMELINE'; index: number }
  | { type: 'SET_PLAYING'; playing: boolean }
  | { type: 'SET_UNCERTAINTY'; on: boolean }
  | { type: 'SELECT_CELL'; cell: { row: number; col: number } | null }
  | { type: 'SET_CONTRAST'; value: number }
  | { type: 'SET_GLOBE_SPIN'; on: boolean }
  | { type: 'SET_THEME'; theme: 'dark' | 'light' }

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'BOOT_READY':
      return {
        ...state,
        bootStatus: 'ready',
        health: action.health,
        meta: action.meta,
        model: state.model ?? action.meta.default_model,
        initDate: state.initDate ?? action.meta.latest_date,
        horizon: Math.min(state.horizon, action.meta.max_horizon),
      }
    case 'BOOT_ERROR':
      return { ...state, bootStatus: 'error', bootError: action.error }
    case 'SET_STATE':
      return { ...state, state: action.state }
    case 'SET_FORECAST':
      return { ...state, forecast: action.forecast }
    case 'SET_VIEW':
      return { ...state, activeView: action.view }
    case 'SET_VARIABLE':
      return { ...state, activeVariable: action.variable }
    case 'SET_MODEL':
      return { ...state, model: action.model }
    case 'SET_HORIZON':
      return { ...state, horizon: action.horizon }
    case 'SET_TIMELINE':
      return { ...state, timelineIndex: action.index }
    case 'SET_PLAYING':
      return { ...state, playing: action.playing }
    case 'SET_UNCERTAINTY':
      return { ...state, uncertainty: action.on }
    case 'SELECT_CELL':
      return { ...state, selectedCell: action.cell }
    case 'SET_CONTRAST':
      return { ...state, gridContrast: action.value }
    case 'SET_GLOBE_SPIN':
      return { ...state, globeSpin: action.on }
    case 'SET_THEME':
      return { ...state, theme: action.theme }
    default:
      return state
  }
}

const StateCtx = createContext<AppState | null>(null)
const DispatchCtx = createContext<Dispatch<Action> | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [health, meta] = await Promise.all([getHealth(), getMeta()])
        if (cancelled) return
        dispatch({ type: 'BOOT_READY', health, meta })
        // Prefetch the live Overview data; failures here are non-fatal (app still boots).
        try {
          const [st, fc] = await Promise.all([
            getState(meta.latest_date),
            getForecast({ date: meta.latest_date, model: meta.default_model }),
          ])
          if (cancelled) return
          dispatch({ type: 'SET_STATE', state: st })
          dispatch({ type: 'SET_FORECAST', forecast: fc })
        } catch {
          /* keep Overview partial rather than crash */
        }
      } catch (e) {
        if (cancelled) return
        dispatch({ type: 'BOOT_ERROR', error: e instanceof Error ? e.message : String(e) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <StateCtx.Provider value={state}>
      <DispatchCtx.Provider value={dispatch}>{children}</DispatchCtx.Provider>
    </StateCtx.Provider>
  )
}

export function useAppState(): AppState {
  const ctx = useContext(StateCtx)
  if (!ctx) throw new Error('useAppState must be used within AppProvider')
  return ctx
}

export function useAppDispatch(): Dispatch<Action> {
  const ctx = useContext(DispatchCtx)
  if (!ctx) throw new Error('useAppDispatch must be used within AppProvider')
  return ctx
}
