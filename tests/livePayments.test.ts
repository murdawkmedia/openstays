import { describe, expect, it } from 'vitest';

import {
  clearEligibilityToken,
  readEligibilityToken,
  storeEligibilityToken,
} from '../src/lib/livePayments';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

describe('scoped payment eligibility storage', () => {
  it('keeps payment and reward tokens isolated and explicitly removable', () => {
    const storage = memoryStorage();
    storeEligibilityToken('wavelength_payment', 'booking_1', 'payment-token', storage);
    storeEligibilityToken('reward_claim', 'OS-1', 'reward-token', storage);

    expect(readEligibilityToken('wavelength_payment', 'booking_1', storage))
      .toBe('payment-token');
    expect(readEligibilityToken('reward_claim', 'OS-1', storage))
      .toBe('reward-token');
    expect(readEligibilityToken('wavelength_payment', 'OS-1', storage))
      .toBeNull();

    clearEligibilityToken('wavelength_payment', 'booking_1', storage);
    expect(readEligibilityToken('wavelength_payment', 'booking_1', storage))
      .toBeNull();
    expect(readEligibilityToken('reward_claim', 'OS-1', storage))
      .toBe('reward-token');
  });
});
