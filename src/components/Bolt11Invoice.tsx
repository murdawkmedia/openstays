import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';

export const BOLT11_QR_MAX_UTF8_BYTES = 2_000;

export type Bolt11InvoiceProps = {
  invoice: string;
  amountSats: number;
  expiresAt?: number;
  label: string;
};

function formatSats(amountSats: number): string {
  return new Intl.NumberFormat('en-US').format(amountSats);
}

function abbreviateInvoice(invoice: string): string {
  if (invoice.length <= 32) return invoice;
  return `${invoice.slice(0, 18)}…${invoice.slice(-10)}`;
}

export function Bolt11Invoice({ invoice, amountSats, expiresAt, label }: Bolt11InvoiceProps) {
  const [copyMessage, setCopyMessage] = useState('');
  const amount = formatSats(amountSats);
  const qrTitle = `${label} QR for ${amount} Signet test sats`;
  const canRenderQr = new TextEncoder().encode(invoice).byteLength <= BOLT11_QR_MAX_UTF8_BYTES;
  const expiry = expiresAt === undefined ? null : new Date(expiresAt);
  const expiryDateTime = expiry !== null && !Number.isNaN(expiry.getTime()) ? expiry.toISOString() : null;
  const expiryText = expiry !== null && !Number.isNaN(expiry.getTime()) ? expiry.toLocaleString() : null;

  async function copyInvoice() {
    try {
      await navigator.clipboard.writeText(invoice);
      setCopyMessage('BOLT11 copied');
    } catch {
      setCopyMessage('Copy failed — select the full invoice below');
    }
  }

  return <section className="min-w-0 rounded-xl border border-stone-200 bg-white p-4 text-stone-900">
    <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
      <span className="rounded-full bg-sky-100 px-3 py-1 text-sky-950">{amount} sats</span>
      <span className="rounded-full bg-stone-100 px-3 py-1 text-stone-800">Signet test sats</span>
    </div>
    <div className="mt-4 flex justify-center">
      {canRenderQr ? <QRCodeSVG
        value={invoice}
        size={220}
        level="M"
        marginSize={4}
        title={qrTitle}
        role="img"
        className="h-auto w-full max-w-[220px]"
      /> : <p className="max-w-sm text-center text-sm text-stone-700">QR unavailable for this unusually long invoice. Copy the full BOLT11 below.</p>}
    </div>
    {expiryDateTime ? <p className="mt-3 text-sm text-stone-700">Expires <time dateTime={expiryDateTime}>{expiryText}</time></p> : null}
    <p className="mt-3 break-all font-mono text-xs text-stone-700">{abbreviateInvoice(invoice)}</p>
    <button
      type="button"
      onClick={copyInvoice}
      className="mt-4 rounded-lg bg-sky-700 px-4 py-2 font-semibold text-white transition hover:bg-sky-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700"
    >
      Copy BOLT11
    </button>
    <p className="mt-2 min-h-5 text-sm text-stone-700" role="status" aria-live="polite">{copyMessage}</p>
    <details className="mt-3 min-w-0">
      <summary className="cursor-pointer font-medium text-stone-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700">Show full invoice</summary>
      <p className="mt-2 select-text break-all rounded-lg bg-stone-100 p-3 font-mono text-xs text-stone-900">{invoice}</p>
    </details>
  </section>;
}
