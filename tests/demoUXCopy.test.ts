import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractErrorMessage } from '../src/components/ErrorMessage';

describe('judge-facing checkout copy', () => {
  it('states that marketing consent is recorded but no campaign is sent', () => {
    const source = readFileSync(new URL('../src/components/GuestForm.tsx', import.meta.url), 'utf8');
    expect(source).toContain('Consent is recorded with your reservation; this demo does not send marketing campaigns.');
  });

  it('suggests the working Consensus Commons promo code', () => {
    const source = readFileSync(new URL('../src/pages/UnitTypePage.tsx', import.meta.url), 'utf8');
    expect(source).toContain("detail.property.slug === 'consensus-commons' ? 'CONSENSUS10' : 'WELCOME10'");
  });

  it('does not show background wallet errors before guest authentication begins', () => {
    const source = readFileSync(new URL('../src/pages/WavelengthWalletPage.tsx', import.meta.url), 'utf8');
    const unauthenticatedSection = source.slice(source.indexOf('{!started ? ('), source.indexOf(') : (', source.indexOf('{!started ? (')));
    expect(unauthenticatedSection).toContain('{error ? <p role="alert"');
    expect(unauthenticatedSection).not.toContain('{displayError ?');
  });

  it('lets a funded guest explicitly refresh the browser wallet balance', () => {
    const source = readFileSync(new URL('../src/pages/WavelengthWalletPage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('useWalletRefresh');
    expect(source).toContain('await refresh.refresh()');
    expect(source).toContain("refresh.refreshPending ? 'Refreshing…' : 'Refresh wallet balance'");
    expect(source).toContain('Pending inbound');
    expect(source).toContain('balance?.pendingInSat');
  });

  it('automatically checks a visible wallet while inbound sats are boarding', () => {
    const source = readFileSync(new URL('../src/pages/WavelengthWalletPage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('WAVELENGTH_BALANCE_REFRESH_INTERVAL_MS');
    expect(source).toContain("document.addEventListener('visibilitychange'");
    expect(source).toContain('shouldAutoRefreshWavelengthBalance');
    expect(source).toContain('Checking automatically every 12 seconds');
    expect(source).toContain('Last checked');
  });
});

describe('staff auth errors', () => {
  it('does not expose missing signing-key internals to a guest', () => {
    const message = extractErrorMessage(new Error('Server Error: Missing environment variable "JWT_PRIVATE_KEY"'));
    expect(message).toBe('Staff authentication is not configured on this demo deployment yet.');
    expect(message).not.toContain('JWT_PRIVATE_KEY');
  });
});
