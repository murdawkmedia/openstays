import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractErrorMessage } from '../src/components/ErrorMessage';

describe('judge-facing checkout copy', () => {
  it('offers a safe single-tab recovery when the browser wallet runtime is already in use', () => {
    const walletSource = readFileSync(new URL('../src/pages/WavelengthWalletPage.tsx', import.meta.url), 'utf8');
    expect(walletSource).toContain("phase === 'error'");
    expect(walletSource).toContain('Close any other OpenStays wallet tab');
    expect(walletSource).toContain('Reload wallet in this tab');
    expect(walletSource).toContain('window.location.reload()');
    expect(walletSource).toContain("phase !== 'error' && displayError");
  });

  it('adopts the shared Signet BOLT11 QR on every current invoice surface', () => {
    const walletSource = readFileSync(new URL('../src/pages/WavelengthWalletPage.tsx', import.meta.url), 'utf8');
    const rewardSource = readFileSync(new URL('../src/pages/ConsensusRewardPage.tsx', import.meta.url), 'utf8');
    const invoiceSource = readFileSync(new URL('../src/components/Bolt11Invoice.tsx', import.meta.url), 'utf8');

    expect(walletSource).toContain("import { Bolt11Invoice } from '../components/Bolt11Invoice';");
    expect(walletSource).toContain("const bookingInvoiceActive = Boolean(request?.bolt11 && request.status === 'invoice_ready' && request.expiresAt > now);");
    expect(walletSource).toContain('{bookingInvoiceActive ? <div className="mt-4"><Bolt11Invoice');
    expect(walletSource).toContain('if (!bookingInvoiceActive || !request?.bolt11) return;');
    expect(walletSource).toContain('if (!bookingInvoiceActive) prepare.resetPrepare();');
    expect(walletSource).toContain('!demoSetup && bookingInvoiceActive && prepare.prepareData && !send.sendData');
    expect(walletSource).toContain('!demoSetup && bookingInvoiceActive && !send.sendData ? (');
    expect(walletSource).toContain('<Bolt11Invoice invoice={request.bolt11} amountSats={request.satsAmount} expiresAt={request.expiresAt} label="Booking invoice" />');
    expect(walletSource).toContain('Invoice expired; waiting for authoritative reconciliation');
    expect(walletSource).toContain('const DEMO_FUNDING_DISPLAY_WINDOW_MS = 10 * 60_000;');
    expect(walletSource).toContain('setDemoFundingDisplayDeadline(Date.now() + DEMO_FUNDING_DISPLAY_WINDOW_MS);');
    expect(walletSource).toContain('const demoFundingInvoiceActive = Boolean(demoFundingInvoice && demoFundingDisplayDeadline && demoFundingDisplayDeadline > now);');
    expect(walletSource).toContain(') : demoFundingInvoiceActive ? (');
    expect(walletSource).toContain('<Bolt11Invoice invoice={demoFundingInvoice} amountSats={DEMO_WALLET_TARGET_SATS} label="Demo wallet funding invoice" />');
    expect(walletSource).toContain('Setup window ended. Confirm no merchant send or inbound activity before reloading to create a replacement.');
    expect(walletSource).toContain('window.setInterval(() => setNow(Date.now()), 1_000)');

    expect(rewardSource).toContain("import { Bolt11Invoice } from '../components/Bolt11Invoice';");
    expect(rewardSource).toContain("const rewardInvoiceHasValidExpiry = typeof reward?.invoiceExpiresAt === 'number' && Number.isFinite(reward.invoiceExpiresAt);");
    expect(rewardSource).toContain("const rewardInvoiceActive = Boolean(reward?.bolt11 && (reward.status === 'invoice_ready' || reward.status === 'paying') && reward.satsAmount === CONSENSUS_REWARD_SATS && rewardInvoiceHasValidExpiry && reward.invoiceExpiresAt > now);");
    expect(rewardSource).toContain('{rewardInvoiceActive ? <div className="mt-4"><Bolt11Invoice');
    expect(rewardSource).toContain('<Bolt11Invoice invoice={reward.bolt11} amountSats={reward.satsAmount} expiresAt={reward.invoiceExpiresAt} label="Consensus reward invoice" />');
    expect(rewardSource).toContain('Invoice expired; waiting for authoritative reconciliation');
    expect(rewardSource).toContain('Invoice expiry is unavailable; QR cannot be shown while awaiting authoritative reconciliation.');
    expect(rewardSource).toContain('This reward invoice uses a legacy amount and cannot be shown. Wait for authoritative reconciliation.');
    expect(rewardSource).toContain('window.setInterval(() => setNow(Date.now()), 1_000)');
    expect(invoiceSource).toContain('const qrTitle = `${label} QR for ${amount} Signet test sats`;');
  });

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
    const unauthenticatedStart = source.indexOf('{!demoSetup && !started ? (');
    const unauthenticatedSection = source.slice(
      unauthenticatedStart,
      source.indexOf(') : (', unauthenticatedStart),
    );
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

  it('offers an explicit loopback-only demo wallet preflight', () => {
    const source = readFileSync(new URL('../src/pages/WavelengthWalletPage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('useWalletReceive');
    expect(source).toContain("isLocalDemoWalletSetup(window.location.hostname, searchParams.get('demoSetup'))");
    expect(source).toContain('receive.receive({');
    expect(source).toContain('amountSat: DEMO_WALLET_TARGET_SATS');
    expect(source).toContain('Prepare demo wallet');
    expect(source).toContain('Demo wallet ready');
    expect(source).toContain('12 judge attempts');
  });
});

describe('staff auth errors', () => {
  it('does not expose missing signing-key internals to a guest', () => {
    const message = extractErrorMessage(new Error('Server Error: Missing environment variable "JWT_PRIVATE_KEY"'));
    expect(message).toBe('Staff authentication is not configured on this demo deployment yet.');
    expect(message).not.toContain('JWT_PRIVATE_KEY');
  });
});
