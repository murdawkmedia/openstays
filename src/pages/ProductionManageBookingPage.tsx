import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { useParams } from 'react-router-dom';

import { api } from '../../convex/_generated/api';
import { ErrorMessage, extractErrorMessage } from '../components/ErrorMessage';
import { Spinner } from '../components/Spinner';
import { formatDisplayDate } from '../lib/dates';
import { formatMoney } from '../lib/money';
import { NotFoundPage } from './NotFoundPage';

export function ProductionManageBookingPage() {
  const { code } = useParams<{ code: string }>();
  const booking = useQuery(api.bookings.byConfirmationCode, code ? { code } : 'skip');
  const cancelByGuest = useMutation(api.bookings.cancelByGuest);
  const postMessage = useMutation((api as any).messages.postGuest);
  const requestRefund = useMutation((api as any).refunds.requestForGuest);
  const [email, setEmail] = useState('');
  const [messageText, setMessageText] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [working, setWorking] = useState<'cancel' | 'message' | 'refund' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelResult, setCancelResult] = useState<{ refundCents: number; paidCents: number } | null>(null);
  const guestAuth = code && email.trim().includes('@') ? { confirmationCode: code, email: email.trim() } : 'skip';
  const thread = useQuery((api as any).messages.listGuest, guestAuth) as Array<{ _id: string; authorRole: 'guest' | 'staff'; authorName: string; text: string; createdAt: number }> | undefined;
  const refund = useQuery((api as any).refunds.forGuest, guestAuth) as { refundablePaymentCount: number; requestedCaseCount: number; completedCaseCount: number; refundableAmountCents: number } | undefined;

  if (!code) return <NotFoundPage />;
  if (booking === undefined) return <Spinner label="Loading booking…" />;
  if (booking === null) return <NotFoundPage />;
  const cancellable = booking.status === 'confirmed' || booking.status === 'hold';

  async function run(kind: 'cancel' | 'message' | 'refund', action: () => Promise<void>) {
    setWorking(kind);
    setError(null);
    try { await action(); }
    catch (cause) { setError(extractErrorMessage(cause)); }
    finally { setWorking(null); }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <section className="card p-8">
        <h1 className="text-2xl font-semibold text-stone-900">Manage your booking</h1>
        <p className="mt-1 text-sm text-stone-500">Confirmation code <span className="font-mono font-medium text-stone-900">{booking.confirmationCode}</span></p>
        <dl className="mt-6 space-y-1 text-sm text-stone-600">
          <div className="flex justify-between"><dt>Stay</dt><dd className="font-medium text-stone-900">{booking.unitTypeName}</dd></div>
          <div className="flex justify-between"><dt>Status</dt><dd className="capitalize">{booking.status.replace('_', ' ')}</dd></div>
          <div className="flex justify-between"><dt>Check-in</dt><dd>{formatDisplayDate(booking.checkIn)}</dd></div>
          <div className="flex justify-between"><dt>Check-out</dt><dd>{formatDisplayDate(booking.checkOut)}</dd></div>
        </dl>
        <label className="field-label mt-6" htmlFor="booking-email">Booking email</label>
        <input id="booking-email" type="email" className="field-input" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@example.com" />
        <p className="mt-2 text-xs text-stone-500">Used to authorize messages, cancellation, and refund requests for this booking.</p>
        {error ? <div className="mt-4"><ErrorMessage message={error} /></div> : null}
        {cancelResult ? <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">Booking cancelled. Paid: {formatMoney(cancelResult.paidCents, booking.currency)}. Refund due: {formatMoney(cancelResult.refundCents, booking.currency)}.</p> : null}
        {cancellable && !confirmCancel ? <button type="button" className="btn-secondary mt-5" onClick={() => setConfirmCancel(true)}>Cancel booking</button> : null}
        {cancellable && confirmCancel ? (
          <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4">
            <p className="text-sm font-semibold text-red-900">Cancel this booking and release its dates?</p>
            <div className="mt-3 flex gap-2"><button type="button" className="inline-flex items-center justify-center rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50" disabled={working !== null || !email.trim()} onClick={() => void run('cancel', async () => { setCancelResult(await cancelByGuest({ confirmationCode: code, email: email.trim() })); setConfirmCancel(false); })}>{working === 'cancel' ? 'Cancelling…' : 'Confirm cancellation'}</button><button type="button" className="btn-secondary" onClick={() => setConfirmCancel(false)}>Keep booking</button></div>
          </div>
        ) : null}
      </section>

      <section className="card p-8" aria-labelledby="conversation-heading">
        <h2 id="conversation-heading" className="text-lg font-semibold text-stone-900">Booking conversation</h2>
        {!email.trim().includes('@') ? <p className="mt-2 text-sm text-stone-500">Enter the booking email above to open the conversation.</p> : thread === undefined ? <div className="mt-3"><Spinner label="Loading messages…" /></div> : (
          <div className="mt-4 space-y-3">{thread.length === 0 ? <p className="text-sm text-stone-500">No messages yet.</p> : thread.map((message) => <article key={message._id} className={`rounded-xl p-3 text-sm ${message.authorRole === 'guest' ? 'bg-emerald-50' : 'bg-stone-100'}`}><p className="font-semibold text-stone-800">{message.authorName}</p><p className="mt-1 whitespace-pre-wrap text-stone-700">{message.text}</p></article>)}</div>
        )}
        <label className="field-label mt-4" htmlFor="booking-message">New message</label>
        <textarea id="booking-message" className="field-input min-h-24" maxLength={2000} value={messageText} onChange={(event) => setMessageText(event.target.value)} />
        <button type="button" className="btn-primary mt-3" disabled={working !== null || !email.trim() || !messageText.trim()} onClick={() => void run('message', async () => { await postMessage({ confirmationCode: code, email: email.trim(), text: messageText }); setMessageText(''); })}>{working === 'message' ? 'Sending…' : 'Send message'}</button>
      </section>

      {refund && (refund.refundablePaymentCount > 0 || refund.requestedCaseCount > 0 || refund.completedCaseCount > 0) ? (
        <section className="card p-8" aria-labelledby="refund-heading">
          <h2 id="refund-heading" className="text-lg font-semibold text-stone-900">Refunds</h2>
          <p className="mt-2 text-sm text-stone-600">Refundable amount: {formatMoney(refund.refundableAmountCents, booking.currency)}. Open requests: {refund.requestedCaseCount}. Completed: {refund.completedCaseCount}.</p>
          {refund.refundablePaymentCount > 0 ? <button type="button" className="btn-secondary mt-4" disabled={working !== null} onClick={() => void run('refund', async () => { await requestRefund({ confirmationCode: code, email: email.trim() }); })}>{working === 'refund' ? 'Requesting…' : 'Request refund review'}</button> : null}
        </section>
      ) : null}
    </div>
  );
}
