import { describe, expect, it } from 'vitest';
import {
  DEMO_WALLET_ATTEMPT_SATS,
  DEMO_WALLET_TARGET_ATTEMPTS,
  DEMO_WALLET_TARGET_SATS,
  demoWalletAttemptsFunded,
  isLocalDemoWalletSetup,
} from '../src/lib/wavelengthDemoWallet';

describe('local demo wallet policy', () => {
  it('pins twelve 1,000-sat attempts to a 12,000-sat target', () => {
    expect(DEMO_WALLET_ATTEMPT_SATS).toBe(1_000);
    expect(DEMO_WALLET_TARGET_ATTEMPTS).toBe(12);
    expect(DEMO_WALLET_TARGET_SATS).toBe(12_000);
  });

  it.each(['127.0.0.1', 'localhost', '::1'])('permits explicit setup on %s', (hostname) => {
    expect(isLocalDemoWalletSetup(hostname, '1')).toBe(true);
  });

  it.each([
    ['openstays.example', '1'],
    ['127.0.0.1', null],
    ['localhost', '0'],
  ])('rejects non-local or implicit setup', (hostname, flag) => {
    expect(isLocalDemoWalletSetup(hostname, flag)).toBe(false);
  });

  it('counts only complete, spendable attempts', () => {
    expect(demoWalletAttemptsFunded(0)).toBe(0);
    expect(demoWalletAttemptsFunded(11_999)).toBe(11);
    expect(demoWalletAttemptsFunded(12_000)).toBe(12);
    expect(demoWalletAttemptsFunded(-1)).toBe(0);
  });
});
