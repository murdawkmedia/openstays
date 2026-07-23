import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Bolt11Invoice } from '../src/components/Bolt11Invoice';

const invoice = 'lntbs10u1exactinvoice';
const expiresAt = 1_900_000_000_000;

function renderInvoice(value = invoice) {
  return renderToStaticMarkup(createElement(Bolt11Invoice, {
    invoice: value,
    amountSats: 1_000,
    expiresAt,
    label: 'Booking invoice',
  }));
}

describe('Bolt11Invoice', () => {
  it('renders an accessible, exact BOLT11 invoice with a QR code', () => {
    const html = renderInvoice();

    expect(html).toContain('<title>Booking invoice QR for 1,000 Signet test sats</title>');
    expect(html).toContain(invoice);
    expect(html).toContain('1,000 sats');
    expect(html).toContain('Signet test sats');
    expect(html).toContain('Copy BOLT11');
    expect(html).toContain('Show full invoice');
    expect(html).toContain(`<time dateTime="${new Date(expiresAt).toISOString()}">`);
  });

  it('encodes the invoice value into the rendered QR SVG', () => {
    const qrForInvoice = renderInvoice().match(/<svg[\s\S]*?<\/svg>/)?.[0];
    const qrForDifferentInvoice = renderInvoice('lntbs10u1differentinvoice').match(/<svg[\s\S]*?<\/svg>/)?.[0];

    expect(qrForInvoice).toContain('<title>Booking invoice QR for 1,000 Signet test sats</title>');
    expect(qrForInvoice).not.toBe(qrForDifferentInvoice);
  });
});
