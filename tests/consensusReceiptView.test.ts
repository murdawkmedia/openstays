import { describe, expect, it } from 'vitest';
import {
  bitcoinBlockUrl,
  parseConsensusReceiptView,
} from '../src/lib/consensusReceiptView';

const canonical = JSON.stringify({
  bookingCommitment: 'opaque-booking',
  consensus: {
    bookingStatus: 'confirmed',
    channelEventsDigest: 'channel-digest',
    notificationEventsDigest: 'notification-digest',
    paymentEventsDigest: 'payment-digest',
    statusHistoryDigest: 'status-digest',
  },
  createdAt: 1_753_286_400_000,
  economic: {
    amountCents: 19,
    currency: 'CAD',
    paymentProvider: 'wavelength',
    paymentStatus: 'paid',
  },
  property: { name: 'Consensus Commons', slug: 'consensus-commons' },
  schema: 'openstays.consensus-receipt.v1',
});

describe('consensus receipt view', () => {
  it('returns only the v1 privacy-safe display fields', () => {
    expect(parseConsensusReceiptView(canonical)).toEqual({
      schema: 'openstays.consensus-receipt.v1',
      bookingCommitment: 'opaque-booking',
      propertyName: 'Consensus Commons',
      propertySlug: 'consensus-commons',
      amountCents: 19,
      currency: 'CAD',
      paymentProvider: 'wavelength',
      paymentStatus: 'paid',
      bookingStatus: 'confirmed',
      statusHistoryDigest: 'status-digest',
      paymentEventsDigest: 'payment-digest',
      notificationEventsDigest: 'notification-digest',
      channelEventsDigest: 'channel-digest',
      createdAt: 1_753_286_400_000,
      formattedJson: JSON.stringify(JSON.parse(canonical), null, 2),
    });
  });

  it.each(['', '{', '[]', '{"schema":"other"}'])('fails closed for %s', (input) => {
    expect(parseConsensusReceiptView(input)).toBeNull();
  });

  it('creates a mainnet block-height link only for a positive integer', () => {
    expect(bitcoinBlockUrl(959_201)).toBe('https://mempool.space/block-height/959201');
    expect(bitcoinBlockUrl(undefined)).toBeNull();
    expect(bitcoinBlockUrl(-1)).toBeNull();
  });
});
