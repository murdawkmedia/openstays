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

function invalidReceipt(mutate: (receipt: Record<string, any>) => void): string {
  const receipt = JSON.parse(canonical) as Record<string, any>;
  mutate(receipt);
  return JSON.stringify(receipt);
}

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

  it.each([
    ['empty input', ''],
    ['malformed JSON', '{'],
    ['array root', '[]'],
    ['wrong schema', '{"schema":"other"}'],
    ['unexpected root guest email', invalidReceipt((receipt) => { receipt.guestEmail = 'guest@example.test'; })],
    ['unexpected property guest email', invalidReceipt((receipt) => { receipt.property.guestEmail = 'guest@example.test'; })],
    ['unexpected economic payment hash', invalidReceipt((receipt) => { receipt.economic.paymentHash = 'payment-hash'; })],
    ['unexpected consensus wallet', invalidReceipt((receipt) => { receipt.consensus.wallet = 'wallet'; })],
    ['missing root booking commitment', invalidReceipt((receipt) => { delete receipt.bookingCommitment; })],
    ['missing property name', invalidReceipt((receipt) => { delete receipt.property.name; })],
    ['missing economic amount', invalidReceipt((receipt) => { delete receipt.economic.amountCents; })],
    ['missing consensus status digest', invalidReceipt((receipt) => { delete receipt.consensus.statusHistoryDigest; })],
    ['null property', invalidReceipt((receipt) => { receipt.property = null; })],
    ['array economic', invalidReceipt((receipt) => { receipt.economic = []; })],
    ['string consensus', invalidReceipt((receipt) => { receipt.consensus = 'confirmed'; })],
    ['non-string booking commitment', invalidReceipt((receipt) => { receipt.bookingCommitment = true; })],
    ['non-string property name', invalidReceipt((receipt) => { receipt.property.name = 42; })],
    ['non-string currency', invalidReceipt((receipt) => { receipt.economic.currency = null; })],
    ['non-string booking status', invalidReceipt((receipt) => { receipt.consensus.bookingStatus = 1; })],
    ['negative amount', invalidReceipt((receipt) => { receipt.economic.amountCents = -1; })],
    ['fractional amount', invalidReceipt((receipt) => { receipt.economic.amountCents = 19.5; })],
    ['unsafe amount', invalidReceipt((receipt) => { receipt.economic.amountCents = Number.MAX_SAFE_INTEGER + 1; })],
    ['non-numeric created at', invalidReceipt((receipt) => { receipt.createdAt = 'now'; })],
    ['non-finite created at', canonical.replace('1753286400000', '1e400')],
  ])('fails closed for %s', (_label, input) => {
    expect(parseConsensusReceiptView(input)).toBeNull();
  });

  it('creates a mainnet block-height link only for a positive integer', () => {
    expect(bitcoinBlockUrl(959_201)).toBe('https://mempool.space/block-height/959201');
    expect(bitcoinBlockUrl(undefined)).toBeNull();
    expect(bitcoinBlockUrl(-1)).toBeNull();
    expect(bitcoinBlockUrl(0)).toBeNull();
    expect(bitcoinBlockUrl(1.5)).toBeNull();
    expect(bitcoinBlockUrl(Number.MAX_SAFE_INTEGER + 1)).toBeNull();
  });
});
