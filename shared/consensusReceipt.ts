type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type ConsensusReceiptInput = {
  bookingCommitment: string;
  propertyName: string;
  propertySlug: string;
  amountCents: number;
  currency: string;
  paymentProvider: string;
  paymentStatus: string;
  bookingStatus: string;
  statusHistoryDigest: string;
  paymentEventsDigest: string;
  notificationEventsDigest: string;
  channelEventsDigest: string;
  createdAt: number;
};

function sortJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sortJson(child)]),
    );
  }
  return value;
}

export function stableStringify(value: JsonValue): string {
  return JSON.stringify(sortJson(value));
}

export function buildCanonicalConsensusReceipt(input: ConsensusReceiptInput): string {
  return stableStringify({
    schema: 'openstays.consensus-receipt.v1',
    bookingCommitment: input.bookingCommitment,
    property: { name: input.propertyName, slug: input.propertySlug },
    economic: {
      amountCents: input.amountCents,
      currency: input.currency,
      paymentProvider: input.paymentProvider,
      paymentStatus: input.paymentStatus,
    },
    consensus: {
      bookingStatus: input.bookingStatus,
      statusHistoryDigest: input.statusHistoryDigest,
      paymentEventsDigest: input.paymentEventsDigest,
      notificationEventsDigest: input.notificationEventsDigest,
      channelEventsDigest: input.channelEventsDigest,
    },
    createdAt: input.createdAt,
  });
}
