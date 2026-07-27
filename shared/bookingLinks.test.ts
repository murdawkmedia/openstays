import { describe, expect, it } from 'vitest';
import { checkoutPath, readGuestConfirmation, walletPath } from './bookingLinks.js';

describe('guest booking links', () => {
  it('uses a confirmation query parameter that Convex Auth does not consume', () => {
    expect(checkoutPath('booking_1', 'OS-A&B')).toBe('/checkout/booking_1?confirmation=OS-A%26B');
    expect(walletPath('booking_1', 'OS-A&B')).toBe('/wallet/pay/booking_1?confirmation=OS-A%26B');
  });

  it('prefers the durable parameter while reading legacy links', () => {
    expect(readGuestConfirmation(new URLSearchParams('confirmation=OS-NEW&code=oauth-code'))).toBe('OS-NEW');
    expect(readGuestConfirmation(new URLSearchParams('code=OS-LEGACY'))).toBe('OS-LEGACY');
  });
});
