import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PUBLIC_CONSENT_VERSION,
  eligibilityEmailDigest,
  readPublicPolicy,
  signEligibilityToken,
  verifyEligibilityToken,
  type VerifiedEligibility,
} from './publicPolicy';

const originalCrypto = globalThis.crypto;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readPublicPolicy', () => {
  it('fails closed with fixed public amounts', () => {
    expect(readPublicPolicy({})).toEqual({
      liveMode: false,
      simulatedEnabled: true,
      zapriteEnabled: false,
      wavelengthEnabled: false,
      rewardsEnabled: false,
      zapriteContributionCents: 100,
      wavelengthPaymentSats: 1000,
      rewardSats: 1000,
      rewardDailyBudgetSats: 0,
      rewardMaxFeeSats: 210,
    });
  });

  it('rejects a live rail without live mode', () => {
    expect(() => readPublicPolicy({ ZAPRITE_ENABLED: 'true' }))
      .toThrow('PUBLIC_LIVE_PAYMENTS_REQUIRED');
  });

  it('rejects destructive demo mode with live rails', () => {
    expect(() => readPublicPolicy({
      DEMO_MODE: 'true',
      PUBLIC_LIVE_PAYMENTS: 'true',
      WAVELENGTH_ENABLED: 'true',
    })).toThrow('LIVE_DEMO_MODE_CONFLICT');
  });

  it('rejects changed fixed amounts and invalid limits', () => {
    expect(() => readPublicPolicy({
      PUBLIC_ZAPRITE_CONTRIBUTION_CENTS: '99',
    })).toThrow('PUBLIC_ZAPRITE_CONTRIBUTION_CENTS must be 100');
    expect(() => readPublicPolicy({
      WAVELENGTH_REWARD_DAILY_BUDGET_SATS: '-1',
    })).toThrow('WAVELENGTH_REWARD_DAILY_BUDGET_SATS must be a non-negative integer');
  });
});

describe('eligibility tokens', () => {
  const signingKey = 'test-only-signing-key-with-at-least-32-bytes';
  const now = Date.UTC(2026, 6, 26, 12);
  const claims: VerifiedEligibility = {
    v: 1,
    jti: 'eligibility-test-1',
    action: 'reward_claim',
    bookingId: 'booking-123',
    emailDigest: 'email-digest',
    deviceDigest: 'device-digest',
    networkDigest: 'network-digest',
    iat: now,
    exp: now + 5 * 60_000,
  };

  it('verifies an exact action and booking', async () => {
    vi.stubGlobal('crypto', originalCrypto);
    const token = await signEligibilityToken(claims, signingKey);

    await expect(verifyEligibilityToken(
      token,
      { action: 'reward_claim', bookingId: 'booking-123' },
      signingKey,
      now,
    )).resolves.toEqual(claims);
  });

  it('rejects a forged, expired, wrong-action, or future-issued token', async () => {
    const token = await signEligibilityToken(claims, signingKey);
    await expect(verifyEligibilityToken(
      `${token.slice(0, -1)}x`,
      { action: 'reward_claim', bookingId: 'booking-123' },
      signingKey,
      now,
    )).rejects.toThrow('ELIGIBILITY_SIGNATURE_INVALID');
    await expect(verifyEligibilityToken(
      token,
      { action: 'zaprite_payment', bookingId: 'booking-123' },
      signingKey,
      now,
    )).rejects.toThrow('ELIGIBILITY_SCOPE_INVALID');
    await expect(verifyEligibilityToken(
      token,
      { action: 'reward_claim', bookingId: 'booking-123' },
      signingKey,
      claims.exp + 1,
    )).rejects.toThrow('ELIGIBILITY_EXPIRED');

    const future = await signEligibilityToken({
      ...claims,
      iat: now + 60_001,
      exp: now + 6 * 60_000,
    }, signingKey);
    await expect(verifyEligibilityToken(
      future,
      { action: 'reward_claim', bookingId: 'booking-123' },
      signingKey,
      now,
    )).rejects.toThrow('ELIGIBILITY_ISSUED_IN_FUTURE');
  });

  it('derives deterministic normalized-email digests', async () => {
    await expect(eligibilityEmailDigest('guest@example.com', signingKey))
      .resolves.toBe(await eligibilityEmailDigest('guest@example.com', signingKey));
    await expect(eligibilityEmailDigest('other@example.com', signingKey))
      .resolves.not.toBe(await eligibilityEmailDigest('guest@example.com', signingKey));
  });
});

describe('public consent version', () => {
  it('is immutable for the first public launch contract', () => {
    expect(PUBLIC_CONSENT_VERSION).toBe('openstays.public-live.v1');
  });
});
