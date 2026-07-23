import { describe, expect, it } from 'vitest';
import {
  shouldAutoRefreshWavelengthBalance,
  WAVELENGTH_BALANCE_REFRESH_INTERVAL_MS,
} from '../src/lib/wavelengthBalanceRefresh';

describe('Wavelength balance auto-refresh', () => {
  it('polls while inbound sats are pending in a visible ready wallet', () => {
    expect(shouldAutoRefreshWavelengthBalance({
      walletPhase: 'ready',
      pendingInSat: 2_500,
      pageVisible: true,
      refreshPending: false,
    })).toBe(true);
  });

  it('uses a demo-friendly interval without hammering the wallet runtime', () => {
    expect(WAVELENGTH_BALANCE_REFRESH_INTERVAL_MS).toBe(12_000);
  });

  it.each([
    ['the tab is hidden', { walletPhase: 'ready', pendingInSat: 2_500, pageVisible: false, refreshPending: false }],
    ['the wallet is not ready', { walletPhase: 'locked', pendingInSat: 2_500, pageVisible: true, refreshPending: false }],
    ['boarding has completed', { walletPhase: 'ready', pendingInSat: 0, pageVisible: true, refreshPending: false }],
    ['another refresh is active', { walletPhase: 'ready', pendingInSat: 2_500, pageVisible: true, refreshPending: true }],
  ])('pauses when %s', (_reason, state) => {
    expect(shouldAutoRefreshWavelengthBalance(state)).toBe(false);
  });
});
