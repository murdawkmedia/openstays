import { describe, expect, it } from 'vitest';
import {
  canConfirmPreparedPayment,
  explainWavelengthError,
  wavelengthRuntimeDiagnostic,
  validateBookingQuote,
} from '../src/lib/wavelengthPayment';

const quote = {
  amountSat: 1_000,
  expectedFeeSat: 2,
  expectedTotalOutflowSat: 1_002,
  totalOutflowKnown: true,
  rail: 'lightning',
  quoteStatus: 'complete',
  paymentHash: 'hash',
  expiresAtUnix: Math.floor(Date.now() / 1_000) + 600,
};

describe('validateBookingQuote', () => {
  it('accepts an exact unexpired off-chain quote', () => {
    expect(validateBookingQuote(quote, 1_000, Date.now())).toEqual({ ok: true });
  });

  it('rejects an amount mismatch and on-chain rail', () => {
    expect(validateBookingQuote({ ...quote, amountSat: 999 }, 1_000, Date.now())).toEqual({
      ok: false, message: 'The wallet quoted a different payment amount. Request a fresh invoice.',
    });
    expect(validateBookingQuote({ ...quote, rail: 'onchain' }, 1_000, Date.now())).toEqual({
      ok: false, message: 'This booking requires an off-chain Wavelength payment.',
    });
  });

  it('rejects expired or incomplete quotes', () => {
    expect(validateBookingQuote({ ...quote, expiresAtUnix: 1 }, 1_000, Date.now()).ok).toBe(false);
    expect(validateBookingQuote({ ...quote, totalOutflowKnown: false }, 1_000, Date.now()).ok).toBe(false);
  });

  it('rejects unknown, excessive, or internally inconsistent fees', () => {
    expect(validateBookingQuote({ ...quote, feeKnown: false }, 1_000, Date.now()).ok).toBe(false);
    expect(validateBookingQuote({ ...quote, expectedFeeSat: 211, expectedTotalOutflowSat: 1_211 }, 1_000, Date.now())).toEqual({
      ok: false, message: 'The wallet fee exceeds the 210 sat demo safety limit. Request a fresh quote.',
    });
    expect(validateBookingQuote({ ...quote, expectedTotalOutflowSat: 1_211 }, 1_000, Date.now()).ok).toBe(false);
    expect(validateBookingQuote({ ...quote, expectedFeeSat: 0, expectedTotalOutflowSat: 1_210 }, 1_000, Date.now())).toEqual({
      ok: false, message: 'The wallet returned inconsistent payment totals. Request a fresh quote.',
    });
    expect(validateBookingQuote({ ...quote, expectedFeeSat: 210, expectedTotalOutflowSat: 1_000 }, 1_000, Date.now()).ok).toBe(false);
  });
});

describe('canConfirmPreparedPayment', () => {
  it('allows exactly one confirm while the request remains invoice-ready', () => {
    expect(canConfirmPreparedPayment('invoice_ready', true, false, false)).toBe(true);
    expect(canConfirmPreparedPayment('invoice_ready', true, true, false)).toBe(false);
    expect(canConfirmPreparedPayment('settled', true, false, false)).toBe(false);
    expect(canConfirmPreparedPayment('failed', true, false, false)).toBe(false);
    expect(canConfirmPreparedPayment('invoice_ready', false, false, false)).toBe(false);
  });
});

describe('explainWavelengthError', () => {
  it('turns a consumed receive intent into retry guidance', () => {
    expect(explainWavelengthError(new Error('rpc AlreadyExists: receive intent already used'))).toBe(
      'That invoice was already used. OpenStays is reconciling it with the merchant before offering a safe replacement.',
    );
  });

  it('turns insufficient funds into funding guidance without exposing RPC text', () => {
    expect(explainWavelengthError(new Error('rpc code ResourceExhausted insufficient balance'))).toBe(
      'This wallet needs more signet test sats before it can pay.',
    );
  });

  it('distinguishes local database failures from a wallet open in another tab', () => {
    expect(explainWavelengthError(new Error(
      'SQLITE_CANTOPEN: sqlite asset unavailable: unable to open database',
    ))).toBe(
      'This browser could not open its local wallet storage. Reload once; if it persists, create or restore the wallet in the refreshed OpenStays wallet.',
    );
    expect(explainWavelengthError(new Error(
      'OPFS database already open in this worker',
    ))).toBe(
      'This browser wallet is already open in another tab. Close the other OpenStays wallet tab, then reload this one.',
    );
  });
});

describe('wavelengthRuntimeDiagnostic', () => {
  it('normalizes and bounds fatal startup details without dumping arbitrary objects', () => {
    expect(wavelengthRuntimeDiagnostic(new Error('  sqlite\nworker   failed  '))).toBe('sqlite worker failed');
    expect(wavelengthRuntimeDiagnostic({ password: 'must-not-render' })).toBe('Wavelength runtime failed');
    expect(wavelengthRuntimeDiagnostic(new Error('x'.repeat(1_000)))).toHaveLength(640);
  });
});
