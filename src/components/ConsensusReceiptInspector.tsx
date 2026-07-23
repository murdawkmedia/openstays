import { useId, type ReactNode } from 'react';
import { bitcoinBlockUrl, parseConsensusReceiptView } from '../lib/consensusReceiptView';
import { formatMoney } from '../lib/money';

const verifierUrl = 'https://opentimestamps.org/';

function formatReceiptMoney(amountCents: number, currency: string): string {
  if (currency !== 'CAD') return formatMoney(amountCents, currency);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'CAD' }).format(amountCents / 100);
}

function ReceiptField({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0">
    <dt className="font-semibold text-stone-700">{label}</dt>
    <dd className="mt-0.5 min-w-0 break-all text-stone-900">{children}</dd>
  </div>;
}

export function ConsensusReceiptInspector({ canonicalJson, bitcoinBlockHeight }: {
  canonicalJson: string;
  bitcoinBlockHeight?: number;
}) {
  const view = parseConsensusReceiptView(canonicalJson);
  const createdAt = view ? new Date(view.createdAt) : null;
  const createdAtText = createdAt !== null && !Number.isNaN(createdAt.getTime()) ? createdAt.toISOString() : null;
  const displayView = createdAtText !== null ? view : null;
  const blockUrl = bitcoinBlockUrl(bitcoinBlockHeight);
  const headingId = useId();

  return <section className="mt-5 min-w-0 rounded-xl border border-stone-200 bg-white p-4" aria-labelledby={headingId}>
    <h3 id={headingId} className="font-semibold text-stone-900">Receipt contents</h3>
    {displayView ? <>
      <dl className="mt-3 grid min-w-0 grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <ReceiptField label="Property">{displayView.propertyName} ({displayView.propertySlug})</ReceiptField>
        <ReceiptField label="Economic / payment">{formatReceiptMoney(displayView.amountCents, displayView.currency)} · {displayView.paymentProvider} · {displayView.paymentStatus}</ReceiptField>
        <ReceiptField label="Booking state">{displayView.bookingStatus}</ReceiptField>
        <ReceiptField label="Created">{createdAtText}</ReceiptField>
        <ReceiptField label="Opaque booking commitment"><span className="break-all font-mono text-xs">{displayView.bookingCommitment}</span></ReceiptField>
        <ReceiptField label="Status history digest"><span className="break-all font-mono text-xs">{displayView.statusHistoryDigest}</span></ReceiptField>
        <ReceiptField label="Payment events digest"><span className="break-all font-mono text-xs">{displayView.paymentEventsDigest}</span></ReceiptField>
        <ReceiptField label="Notification events digest"><span className="break-all font-mono text-xs">{displayView.notificationEventsDigest}</span></ReceiptField>
        <ReceiptField label="Channel events digest"><span className="break-all font-mono text-xs">{displayView.channelEventsDigest}</span></ReceiptField>
      </dl>
      {blockUrl ? <p className="mt-4 text-sm"><a href={blockUrl} target="_blank" rel="noreferrer" className="underline">View Bitcoin block {bitcoinBlockHeight}</a></p> : null}
      <details className="mt-4">
        <summary className="cursor-pointer font-medium text-stone-900">View canonical receipt</summary>
        <pre className="mt-2 max-w-full overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-stone-950 p-3 text-xs text-stone-100">{displayView.formattedJson}</pre>
      </details>
    </> : <p className="mt-3 text-sm text-stone-600">Receipt preview unavailable. Download the receipt JSON to inspect the original record.</p>}
    <p className="mt-4 text-sm text-stone-700"><a href={verifierUrl} target="_blank" rel="noreferrer" className="underline">Verify at OpenTimestamps.org</a></p>
    <p className="mt-1 text-xs text-stone-600">Upload the receipt JSON and matching .ots proof.</p>
  </section>;
}
