import { describe, expect, it, vi } from 'vitest';

import {
  issueEligibilityToken,
  verifyTurnstile,
} from '../src/eligibility';

function decodeClaims(token: string): Record<string, unknown> {
  const [payload] = token.split('.');
  return JSON.parse(
    Buffer.from(payload.replaceAll('-', '+').replaceAll('_', '/'), 'base64')
      .toString('utf8'),
  ) as Record<string, unknown>;
}

describe('eligibility tokens', () => {
  it('verifies Turnstile through the authoritative Siteverify endpoint', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(init?.body)).toContain('secret=secret');
      expect(String(init?.body)).toContain('response=challenge');
      expect(String(init?.body)).toContain('remoteip=203.0.113.8');
      return new Response(JSON.stringify({ success: true }));
    });
    await expect(verifyTurnstile(
      'secret',
      'challenge',
      '203.0.113.8',
      fetcher,
    )).resolves.toBe(true);
  });

  it('issues five-minute scoped HMAC claims without retaining a raw IP', async () => {
    vi.stubGlobal('crypto', globalThis.crypto);
    const now = Date.UTC(2026, 6, 26, 12);
    const token = await issueEligibilityToken({
      action: 'reward_claim',
      bookingId: 'booking_1',
      normalizedEmail: 'guest@example.test',
      deviceId: 'a'.repeat(32),
      ip: '203.0.113.8',
    }, 'test-signing-key-with-at-least-32-bytes', now);
    const claims = decodeClaims(token);

    expect(claims).toMatchObject({
      v: 1,
      action: 'reward_claim',
      bookingId: 'booking_1',
      iat: now,
      exp: now + 300_000,
    });
    expect(claims.jti).toEqual(expect.any(String));
    expect(claims.emailDigest).toEqual(expect.any(String));
    expect(claims.deviceDigest).toEqual(expect.any(String));
    expect(claims.networkDigest).toEqual(expect.any(String));
    expect(JSON.stringify(claims)).not.toContain('203.0.113.8');
    expect(JSON.stringify(claims)).not.toContain('guest@example.test');
  });

  it('changes its signature when any scoped claim changes', async () => {
    const originalCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', {
      subtle: originalCrypto.subtle,
      randomUUID: () => '00000000-0000-4000-8000-000000000000',
    });
    const base = {
      action: 'wavelength_payment' as const,
      bookingId: 'booking_1',
      normalizedEmail: 'guest@example.test',
      deviceId: 'b'.repeat(32),
      ip: '203.0.113.8',
    };
    const key = 'test-signing-key-with-at-least-32-bytes';
    const first = await issueEligibilityToken(base, key, 1_000);
    const changed = await issueEligibilityToken(
      { ...base, bookingId: 'booking_2' },
      key,
      1_000,
    );
    expect(first.split('.')[1]).not.toBe(changed.split('.')[1]);
  });

  it('rotates the network digest by UTC day without exposing the address', async () => {
    const base = {
      action: 'reward_claim' as const,
      bookingId: 'booking_1',
      normalizedEmail: 'guest@example.test',
      deviceId: 'd'.repeat(32),
      ip: '203.0.113.8',
    };
    const key = 'test-signing-key-with-at-least-32-bytes';
    const first = decodeClaims(await issueEligibilityToken(
      base,
      key,
      Date.UTC(2026, 6, 26, 23, 59),
    ));
    const nextDay = decodeClaims(await issueEligibilityToken(
      base,
      key,
      Date.UTC(2026, 6, 27, 0, 1),
    ));
    expect(first.networkDigest).not.toBe(nextDay.networkDigest);
    expect(JSON.stringify([first, nextDay])).not.toContain(base.ip);
  });
});
