type BookingQuote = {
  amountSat: number;
  expectedFeeSat: number;
  expectedTotalOutflowSat: number;
  feeKnown?: boolean;
  totalOutflowKnown: boolean;
  rail: string;
  quoteStatus: string;
  paymentHash: string;
  expiresAtUnix: number;
};

export const WAVELENGTH_BOOKING_MAX_FEE_SATS = 210;

export function validateBookingQuote(quote: BookingQuote, expectedSats: number, nowMs: number):
  { ok: true } | { ok: false; message: string } {
  if (quote.amountSat !== expectedSats) {
    return { ok: false, message: 'The wallet quoted a different payment amount. Request a fresh invoice.' };
  }
  if (quote.rail === 'onchain' || quote.rail === 'unspecified') {
    return { ok: false, message: 'This booking requires an off-chain Wavelength payment.' };
  }
  if (
    quote.feeKnown === false ||
    !Number.isInteger(quote.expectedFeeSat) ||
    quote.expectedFeeSat < 0 ||
    !quote.totalOutflowKnown ||
    quote.expectedTotalOutflowSat < quote.amountSat ||
    !quote.paymentHash
  ) {
    return { ok: false, message: 'The wallet could not produce a complete payment quote. Try again.' };
  }
  if (
    quote.expectedFeeSat > WAVELENGTH_BOOKING_MAX_FEE_SATS ||
    quote.expectedTotalOutflowSat > quote.amountSat + WAVELENGTH_BOOKING_MAX_FEE_SATS
  ) {
    return { ok: false, message: 'The wallet fee exceeds the 210 sat demo safety limit. Request a fresh quote.' };
  }
  if (quote.expectedTotalOutflowSat !== quote.amountSat + quote.expectedFeeSat) {
    return { ok: false, message: 'The wallet returned inconsistent payment totals. Request a fresh quote.' };
  }
  if (quote.quoteStatus !== 'complete' || quote.expiresAtUnix * 1_000 <= nowMs + 15_000) {
    return { ok: false, message: 'This payment quote expired. Prepare a fresh quote.' };
  }
  return { ok: true };
}

export function canConfirmPreparedPayment(
  requestStatus: string | undefined,
  hasPreparedQuote: boolean,
  hasDispatchedPayment: boolean,
  sendPending: boolean,
): boolean {
  return (
    requestStatus === 'invoice_ready' &&
    hasPreparedQuote &&
    !hasDispatchedPayment &&
    !sendPending
  );
}

export function explainWavelengthError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (normalized.includes('alreadyexists') || normalized.includes('already used')) {
    return 'That invoice was already used. OpenStays is reconciling it with the merchant before offering a safe replacement.';
  }
  if (
    normalized.includes('insufficient') ||
    normalized.includes('resourceexhausted') ||
    normalized.includes('underfunded')
  ) {
    return 'This wallet needs more signet test sats before it can pay.';
  }
  if (normalized.includes('expired')) return 'That invoice expired. Request a fresh signet invoice.';
  if (normalized.includes('network')) return 'The wallet and merchant must both be connected to Bitcoin signet.';
  return 'The wallet could not complete that step. No booking payment was recorded; try again or request a fresh invoice.';
}

export function wavelengthRuntimeDiagnostic(error: unknown): string {
  if (!(error instanceof Error)) return 'Wavelength runtime failed';
  return error.message.replace(/\s+/g, ' ').trim().slice(0, 640) || 'Wavelength runtime failed';
}
