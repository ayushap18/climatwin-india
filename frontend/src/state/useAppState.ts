// state/useAppState.ts — convenience re-exports so components can import the hooks
// from one place without pulling in the Provider/JSX module path.
export { useAppState, useAppDispatch } from './AppContext'
export type { AppState, ViewId, BootStatus } from './AppContext'
