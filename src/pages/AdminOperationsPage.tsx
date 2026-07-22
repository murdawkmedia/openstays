import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from 'convex/react';
import type { Id } from '../../convex/_generated/dataModel';
import { api } from '../../convex/_generated/api';
import { Spinner } from '../components/Spinner';
import { ErrorMessage, extractErrorMessage } from '../components/ErrorMessage';
import { formatMoney } from '../lib/money';
import { useStaffGate } from '../lib/useStaff';

type ThreadSummary = { bookingId: Id<'bookings'>; confirmationCode: string; guestName: string; lastMessage: string };
type Message = { _id: string; authorRole: 'guest' | 'staff'; authorName: string; text: string };

export function AdminOperationsPage() {
  const gate = useStaffGate();
  const [params, setParams] = useSearchParams();
  const threads = useQuery((api as any).messages.staffThreads, gate.status === 'staff' ? {} : 'skip') as ThreadSummary[] | undefined;
  const refunds = useQuery((api as any).refunds.listOpen, gate.status === 'staff' ? {} : 'skip') as any[] | undefined;
  const receipts = useQuery((api as any).consensusReceipts.staffOverview, gate.status === 'staff' ? {} : 'skip') as any[] | undefined;
  const selected = params.get('booking') as Id<'bookings'> | null;
  const messages = useQuery((api as any).messages.listStaff, gate.status === 'staff' && selected ? { bookingId: selected } : 'skip') as Message[] | undefined;
  const postStaff = useMutation((api as any).messages.postStaff);
  const completeRefund = useMutation((api as any).refunds.complete);
  const retryReceipt = useMutation((api as any).consensusReceipts.retry);
  const [draft, setDraft] = useState('');
  const [references, setReferences] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selected && threads?.[0]) setParams({ booking: threads[0].bookingId }, { replace: true });
  }, [selected, setParams, threads]);

  if (gate.status === 'loading') return <Spinner label="Checking staff access…" />;
  if (gate.status !== 'staff') return <Navigate to="/admin/login" replace />;

  async function send() {
    if (!selected || !draft.trim()) return;
    try {
      setError(null);
      await postStaff({ bookingId: selected, text: draft });
      setDraft('');
    } catch (err) { setError(extractErrorMessage(err)); }
  }

  async function resolve(refundCaseId: string) {
    try {
      setError(null);
      await completeRefund({ refundCaseId, externalReference: references[refundCaseId] ?? '' });
    } catch (err) { setError(extractErrorMessage(err)); }
  }

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-sm font-medium text-emerald-700">Consensus operations</p><h1 className="text-2xl font-semibold text-stone-900">Messages & manual refunds</h1></div>
        <Link to="/admin" className="text-sm text-stone-500 hover:text-stone-800">← Booking tape</Link>
      </header>
      {error ? <ErrorMessage message={error} /> : null}
      <section className="card p-5">
        <h2 className="text-lg font-semibold text-stone-900">Open refund cases</h2>
        <p className="mt-1 text-sm text-stone-500">Zaprite and Wavelength remain paid until a human records the external refund.</p>
        {refunds === undefined ? <Spinner label="Loading refunds…" /> : refunds.length === 0 ? <p className="mt-4 text-sm text-emerald-700">No unresolved refunds.</p> : (
          <div className="mt-4 space-y-4">{refunds.map((item) => (
            <div key={item._id} className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex flex-wrap justify-between gap-2"><strong>{item.confirmationCode} · {item.provider}</strong><span>{formatMoney(item.amountCents, item.currency)}</span></div>
              <p className="mt-1 text-sm text-stone-600">{item.reason.replaceAll('_', ' ')}</p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input className="field-input" value={references[item._id] ?? ''} onChange={(event) => setReferences((current) => ({ ...current, [item._id]: event.target.value }))} placeholder="Refund reference or Bitcoin txid" aria-label={`External reference for ${item.confirmationCode}`} />
                <button type="button" className="btn-primary shrink-0" disabled={!references[item._id]?.trim()} onClick={() => void resolve(item._id)}>Record completed</button>
              </div>
            </div>
          ))}</div>
        )}
      </section>
      <section className="card p-5">
        <h2 className="text-lg font-semibold text-stone-900">Consensus receipts & rewards</h2>
        <p className="mt-1 text-sm text-stone-500">OpenTimestamps anchors to Bitcoin mainnet; the 210-sat guest reward remains signet-only.</p>
        {receipts === undefined ? <Spinner label="Loading consensus receipts…" /> : receipts.length === 0 ? <p className="mt-4 text-sm text-stone-500">No confirmed receipt work yet.</p> : <div className="mt-4 space-y-3">{receipts.map((receipt) => <article key={receipt._id} className="rounded-xl border border-stone-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><strong>{receipt.confirmationCode}</strong><div className="flex gap-2"><span className="rounded-full bg-stone-100 px-2 py-1 text-xs">OTS: {receipt.status}</span><span className="rounded-full bg-amber-100 px-2 py-1 text-xs">Reward: {receipt.rewardStatus ?? 'locked'}</span></div></div>
          <p className="mt-2 break-all font-mono text-xs text-stone-500">{receipt.sha256}</p>
          {receipt.failureReason || receipt.rewardFailureReason ? <p role="alert" className="mt-2 text-sm text-red-700">{receipt.failureReason ?? receipt.rewardFailureReason}</p> : null}
          {receipt.status === 'failed' ? <button type="button" className="btn-secondary mt-3" onClick={() => void retryReceipt({ receiptId: receipt._id })}>Retry timestamp</button> : null}
        </article>)}</div>}
      </section>
      <section className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <div className="card p-4"><h2 className="font-semibold text-stone-900">Booking threads</h2><div className="mt-3 space-y-2">{threads?.map((thread) => (
          <button key={thread.bookingId} type="button" onClick={() => setParams({ booking: thread.bookingId })} className={`w-full rounded-lg p-3 text-left text-sm ${selected === thread.bookingId ? 'bg-emerald-50 ring-1 ring-emerald-300' : 'bg-stone-50 hover:bg-stone-100'}`}>
            <strong className="block text-stone-900">{thread.guestName} · {thread.confirmationCode}</strong><span className="mt-1 block truncate text-stone-500">{thread.lastMessage}</span>
          </button>
        ))}{threads?.length === 0 ? <p className="text-sm text-stone-500">No conversations yet.</p> : null}</div></div>
        <div className="card p-5"><h2 className="font-semibold text-stone-900">Conversation</h2>{!selected ? <p className="mt-4 text-sm text-stone-500">Select a booking thread.</p> : <>
          <div className="mt-4 min-h-40 space-y-3" aria-live="polite">{messages?.map((message) => <article key={message._id} className={`rounded-xl p-3 text-sm ${message.authorRole === 'staff' ? 'ml-8 bg-emerald-50' : 'mr-8 bg-stone-100'}`}><p className="text-xs font-semibold text-stone-500">{message.authorName}</p><p className="mt-1 whitespace-pre-wrap break-words">{message.text}</p></article>)}</div>
          <textarea className="field-input mt-4 min-h-24" maxLength={2000} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Reply to the guest…" />
          <div className="mt-2 flex justify-between"><span className="text-xs text-stone-400">{draft.length}/2,000</span><button type="button" className="btn-primary" disabled={!draft.trim()} onClick={() => void send()}>Send reply</button></div>
        </>}</div>
      </section>
    </div>
  );
}
