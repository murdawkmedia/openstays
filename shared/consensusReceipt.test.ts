import { describe, expect, it } from 'vitest';
import { buildCanonicalConsensusReceipt, stableStringify } from './consensusReceipt';

describe('stableStringify', () => {
  it('sorts object keys recursively without changing array order', () => {
    expect(stableStringify({ z: 1, nested: { b: 2, a: 1 }, list: [{ y: 2, x: 1 }] }))
      .toBe('{"list":[{"x":1,"y":2}],"nested":{"a":1,"b":2},"z":1}');
  });
});

describe('buildCanonicalConsensusReceipt', () => {
  it('emits a deterministic privacy-safe receipt', () => {
    const canonical = buildCanonicalConsensusReceipt({
      bookingCommitment: 'a'.repeat(64),
      propertyName: 'Consensus Commons',
      propertySlug: 'consensus-commons',
      amountCents: 2100,
      currency: 'CAD',
      paymentProvider: 'wavelength',
      paymentStatus: 'paid',
      bookingStatus: 'confirmed',
      statusHistoryDigest: 'b'.repeat(64),
      paymentEventsDigest: 'c'.repeat(64),
      notificationEventsDigest: 'd'.repeat(64),
      channelEventsDigest: 'e'.repeat(64),
      createdAt: 1_721_667_600_000,
    });

    expect(JSON.parse(canonical)).toMatchObject({
      schema: 'openstays.consensus-receipt.v1',
      bookingCommitment: 'a'.repeat(64),
      property: { name: 'Consensus Commons', slug: 'consensus-commons' },
      economic: { amountCents: 2100, currency: 'CAD', paymentProvider: 'wavelength', paymentStatus: 'paid' },
      consensus: { bookingStatus: 'confirmed' },
      createdAt: 1_721_667_600_000,
    });
    for (const forbidden of [
      'satoshi@example.test', 'OS-SECRET', '2026-07-23', 'node-210',
      'lntbs', 'payment_hash', 'message', 'notes',
    ]) expect(canonical).not.toContain(forbidden);
    expect(buildCanonicalConsensusReceipt(JSON.parse(JSON.stringify({
      bookingCommitment: 'a'.repeat(64), propertyName: 'Consensus Commons', propertySlug: 'consensus-commons',
      amountCents: 2100, currency: 'CAD', paymentProvider: 'wavelength', paymentStatus: 'paid',
      bookingStatus: 'confirmed', statusHistoryDigest: 'b'.repeat(64), paymentEventsDigest: 'c'.repeat(64),
      notificationEventsDigest: 'd'.repeat(64), channelEventsDigest: 'e'.repeat(64), createdAt: 1_721_667_600_000,
    })))).toBe(canonical);
  });
});
