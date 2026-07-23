const RECEIPT_SCHEMA = 'openstays.consensus-receipt.v1';

export type ConsensusReceiptView = {
  schema: typeof RECEIPT_SCHEMA;
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
  formattedJson: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function stringField(object: Record<string, unknown>, field: string): string | null {
  const value = object[field];
  return typeof value === 'string' ? value : null;
}

export function parseConsensusReceiptView(canonicalJson: string): ConsensusReceiptView | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(canonicalJson);
  } catch {
    return null;
  }

  if (!isPlainObject(parsed) || parsed.schema !== RECEIPT_SCHEMA) return null;

  const property = parsed.property;
  const economic = parsed.economic;
  const consensus = parsed.consensus;
  if (!isPlainObject(property) || !isPlainObject(economic) || !isPlainObject(consensus)) return null;

  const bookingCommitment = stringField(parsed, 'bookingCommitment');
  const propertyName = stringField(property, 'name');
  const propertySlug = stringField(property, 'slug');
  const currency = stringField(economic, 'currency');
  const paymentProvider = stringField(economic, 'paymentProvider');
  const paymentStatus = stringField(economic, 'paymentStatus');
  const bookingStatus = stringField(consensus, 'bookingStatus');
  const statusHistoryDigest = stringField(consensus, 'statusHistoryDigest');
  const paymentEventsDigest = stringField(consensus, 'paymentEventsDigest');
  const notificationEventsDigest = stringField(consensus, 'notificationEventsDigest');
  const channelEventsDigest = stringField(consensus, 'channelEventsDigest');
  const amountCents = economic.amountCents;
  const createdAt = parsed.createdAt;

  if (
    bookingCommitment === null
    || propertyName === null
    || propertySlug === null
    || currency === null
    || paymentProvider === null
    || paymentStatus === null
    || bookingStatus === null
    || statusHistoryDigest === null
    || paymentEventsDigest === null
    || notificationEventsDigest === null
    || channelEventsDigest === null
    || typeof amountCents !== 'number'
    || !Number.isSafeInteger(amountCents)
    || amountCents < 0
    || typeof createdAt !== 'number'
    || !Number.isFinite(createdAt)
  ) return null;

  return {
    schema: RECEIPT_SCHEMA,
    bookingCommitment,
    propertyName,
    propertySlug,
    amountCents,
    currency,
    paymentProvider,
    paymentStatus,
    bookingStatus,
    statusHistoryDigest,
    paymentEventsDigest,
    notificationEventsDigest,
    channelEventsDigest,
    createdAt,
    formattedJson: JSON.stringify(parsed, null, 2),
  };
}

export function bitcoinBlockUrl(blockHeight: number | undefined): string | null {
  if (typeof blockHeight !== 'number' || !Number.isSafeInteger(blockHeight) || blockHeight <= 0) return null;
  return `https://mempool.space/block-height/${blockHeight}`;
}
