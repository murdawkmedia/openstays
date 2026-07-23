export interface WavelengthBalanceRefreshState {
  walletPhase: string;
  pendingInSat: number;
  pageVisible: boolean;
  refreshPending: boolean;
}

export const WAVELENGTH_BALANCE_REFRESH_INTERVAL_MS = 12_000;

export function shouldAutoRefreshWavelengthBalance(
  state: WavelengthBalanceRefreshState,
): boolean {
  return state.walletPhase === 'ready' && state.pendingInSat > 0 &&
    state.pageVisible && !state.refreshPending;
}
