import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MainnetInvoice } from '../src/pages/WavelengthWalletPage';

describe('MainnetInvoice', () => {
  it('shows an explicit, copyable, exact 210-sat external-wallet invoice', () => {
    const html = renderToStaticMarkup(createElement(MainnetInvoice, { request: {
      network: 'mainnet', status: 'invoice_ready', satsAmount: 210,
      quotedAmountCents: 21, currency: 'CAD', expiresAt: 2_000_000_000_000,
      bolt11: 'lnbc210-mainnet-invoice',
    } }));
    expect(html).toContain('REAL BITCOIN');
    expect(html).toContain('210 sats');
    expect(html).toContain('lnbc210-mainnet-invoice');
    expect(html).toContain('separate Lightning wallet');
    expect(html).toContain('Copy Lightning invoice');
    expect(html).not.toContain('Create local wallet');
    expect(html).not.toContain('Unlock local wallet');
  });
});
