import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from 'convex/react';

import { api } from '../../convex/_generated/api';
import { Spinner } from '../components/Spinner';
import { ErrorMessage, extractErrorMessage } from '../components/ErrorMessage';
import { formatMoney } from '../lib/money';
import { formatDisplayDate } from '../lib/dates';
import { NotFoundPage } from './NotFoundPage';
import { ConsensusReceiptSummary } from '../components/ConsensusReceiptSummary';
import { TurnstileChallenge } from '../components/TurnstileChallenge';
import {
  getPublicDeviceId,
  requestEligibilityToken,
  storeEligibilityToken,
} from '../lib/livePayments';
import { PUBLIC_SHOWCASE } from '../lib/publicShowcase';
import { FictionalBookingNotice } from '../components/FictionalBookingNotice';

export function ManageBookingPage() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const booking = useQuery(api.bookings.byConfirmationCode, code ? { code } : 'skip');
  const cancelByGuest = useMutation(api.bookings.cancelByGuest);
  const postMessage = useMutation((api as any).messages.postGuest);
  const requestPublicRefund = useMutation((api as any).refunds.requestForGuest);

  const [email, setEmail] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ refundCents: number; paidCents: number } | null>(null);
  const [messageText, setMessageText] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [rewardCheckToken, setRewardCheckToken] = useState<string | null>(null);
  const [openingReward, setOpeningReward] = useState(false);
  const [requestingRefund, setRequestingRefund] = useState(false);
  const thread = useQuery(
    (api as any).messages.listGuest,
    code && email.trim().includes('@') ? { confirmationCode: code, email: email.trim() } : 'skip',
  ) as Array<{ _id: string; authorRole: 'guest' | 'staff'; authorName: string; text: string }> | undefined;
  const consensus = useQuery(
    (api as any).consensus.forGuest,
    code && email.trim().includes('@') ? { confirmationCode: code, email: email.trim() } : 'skip',
  ) as Array<{ key: string; label: string; state: 'reached' | 'pending' | 'attention' | 'ready'; detail: string }> | undefined;
  const guestAuth = code && email.trim().includes('@') ? { confirmationCode: code, email: email.trim() } : 'skip';
  const receipt = useQuery((api as any).consensusReceipts.forGuest, guestAuth) as any;
  const reward = useQuery((api as any).wavelengthRewards.forGuest, guestAuth) as any;
  const publicRefund = useQuery((api as any).refunds.forGuest, guestAuth) as
    | {
        refundablePaymentCount: number;
        requestedCaseCount: number;
        completedCaseCount: number;
        refundableAmountCents: number;
      }
    | undefined;
  const operations = useQuery((api as any).operationsHealth.publicAvailability) as
    | { rewardAvailable: boolean }
    | undefined;

  if (!code) return <NotFoundPage />;
  if (booking === undefined) return <Spinner label="Loading booking…" />;
  if (booking === null) return <NotFoundPage />;

  const cancellable = booking.status === 'confirmed' || booking.status === 'hold';
  const cancelled = booking.status === 'cancelled';

  async function handleCancel() {
    setCancelling(true);
    setError(null);
    try {
      const outcome = await cancelByGuest({ confirmationCode: code!, email: email.trim() });
      setResult(outcome);
      setShowConfirm(false);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setCancelling(false);
    }
  }

  async function handleMessage() {
    if (!messageText.trim()) return;
    setSendingMessage(true);
    setError(null);
    try {
      await postMessage({ confirmationCode: code!, email: email.trim(), text: messageText });
      setMessageText('');
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSendingMessage(false);
    }
  }

  async function handleRewardClaim() {
    if (!code || !email.trim().includes('@') || !reward?.bookingId) {
      setError('Enter the booking email before claiming the reward.');
      return;
    }
    setOpeningReward(true);
    setError(null);
    try {
      if (PUBLIC_SHOWCASE.enabled) {
        if (!rewardCheckToken) {
          throw new Error('Complete the reward anti-abuse check first.');
        }
        const eligibilityToken = await requestEligibilityToken({
          action: 'reward_claim',
          bookingId: String(reward.bookingId),
          normalizedEmail: email.trim().toLowerCase(),
          deviceId: getPublicDeviceId(),
          turnstileToken: rewardCheckToken,
        });
        storeEligibilityToken('reward_claim', code, eligibilityToken);
      }
      navigate(
        `/wallet/reward/${encodeURIComponent(code)}?email=${encodeURIComponent(email.trim())}`,
      );
    } catch (err) {
      setError(extractErrorMessage(err));
      setOpeningReward(false);
    }
  }

  async function handlePublicRefundRequest() {
    setRequestingRefund(true);
    setError(null);
    try {
      await requestPublicRefund({
        confirmationCode: code!,
        email: email.trim(),
      });
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setRequestingRefund(false);
    }
  }

  function download(name: string, data: BlobPart, type: string) {
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(new Blob([data], { type }));
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="card p-8">
        <h1 className="text-2xl font-semibold text-stone-900">Manage your booking</h1>
        {PUBLIC_SHOWCASE.enabled ? <FictionalBookingNotice /> : null}
        <p className="mt-1 text-sm text-stone-500">
          Confirmation code <span className="font-mono font-medium text-stone-900">{booking.confirmationCode}</span>
        </p>

        <dl className="mt-6 space-y-1 text-sm text-stone-600">
          <div className="flex justify-between">
            <dt>Stay</dt>
            <dd className="font-medium text-stone-900">{booking.unitTypeName}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Status</dt>
            <dd className="capitalize">{booking.status.replace('_', ' ')}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Check-in</dt>
            <dd>{formatDisplayDate(booking.checkIn)}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Check-out</dt>
            <dd>{formatDisplayDate(booking.checkOut)}</dd>
          </div>
        </dl>

        {booking.status === 'cancelled' ? (
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4" role="status">
            <p className="font-semibold text-amber-950">This booking is cancelled.</p>
            <p className="mt-1 text-sm text-amber-900">
              Historical milestones and the immutable timestamp receipt remain below for reference.
            </p>
          </div>
        ) : null}

        <section className="mt-6 border-t border-stone-200 pt-6" aria-labelledby="booking-chat-heading">
          <h2 id="booking-chat-heading" className="text-lg font-semibold text-stone-900">Booking conversation</h2>
          <p className="mt-1 text-sm text-stone-500">Messages stay with this reservation. Email alerts link back here.</p>
          <label className="field-label mt-4" htmlFor="conversation-email">Booking email</label>
          <input id="conversation-email" type="email" className="field-input" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" />
          <p className="mt-2 text-xs text-stone-500">
            Enter it once to open your conversation, booking history, and available actions.
          </p>
          {thread ? (
            <div className="mt-4 space-y-3" aria-live="polite">
              {thread.length === 0 ? <p className="text-sm text-stone-500">No messages yet. Ask the host anything about your stay.</p> : thread.map((message) => (
                <article key={message._id} className={`rounded-xl p-3 text-sm ${message.authorRole === 'guest' ? 'ml-8 bg-emerald-50' : 'mr-8 bg-stone-100'}`}>
                  <p className="text-xs font-semibold text-stone-500">{message.authorName}</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-stone-800">{message.text}</p>
                </article>
              ))}
              <textarea className="field-input min-h-24 resize-y" value={messageText} onChange={(event) => setMessageText(event.target.value)} maxLength={2000} placeholder="Write a message…" aria-label="Message" />
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-stone-400">{messageText.length}/2,000</span>
                <button type="button" className="btn-primary" disabled={sendingMessage || !messageText.trim()} onClick={() => void handleMessage()}>{sendingMessage ? 'Sending…' : 'Send message'}</button>
              </div>
            </div>
          ) : <p className="mt-3 text-sm text-stone-500">Booking details stay hidden until the email matches this reservation.</p>}
        </section>

        {consensus ? <section className="mt-6 border-t border-stone-200 pt-6" aria-labelledby="consensus-heading">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Consensus Commons</p>
          <h2 id="consensus-heading" className="mt-1 text-lg font-semibold text-stone-900">
            {cancelled ? 'Booking history' : 'Consensus reached'}
          </h2>
          <ol className="mt-4 space-y-3">{consensus.map((step) => (
            <li key={step.key} className="grid grid-cols-[1rem_1fr] gap-3">
              <span className={`mt-1 h-3 w-3 rounded-full ${step.state === 'reached' ? 'bg-emerald-500' : step.state === 'attention' ? 'bg-amber-500' : 'bg-stone-300'}`} aria-hidden="true" />
              <div><p className="text-sm font-semibold text-stone-800">{step.label}</p><p className="text-xs text-stone-500">{step.detail}</p></div>
            </li>
          ))}</ol>
        </section> : null}

        {receipt && reward && PUBLIC_SHOWCASE.enabled && reward.status !== 'paid'
          && operations?.rewardAvailable ? (
          <section className="mt-6 rounded-xl border border-sky-200 bg-sky-50 p-4">
            <h2 className="font-semibold text-sky-950">Reward eligibility check</h2>
            <p className="mt-1 text-sm text-sky-900">
              One 1,000-sat signet reward is available per person, device, and
              network every 24 hours while the merchant bridge is healthy.
            </p>
            <TurnstileChallenge onToken={setRewardCheckToken} />
            {openingReward ? <p role="status" className="mt-2 text-sm text-sky-900">Opening wallet…</p> : null}
          </section>
        ) : null}

        {receipt && reward && PUBLIC_SHOWCASE.enabled && reward.status !== 'paid'
          && operations && !operations.rewardAvailable ? (
          <p role="status" className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            The 1,000-sat signet reward is temporarily unavailable while the
            merchant bridge or funded reward budget is unhealthy. Your receipt
            and reward eligibility remain recorded.
          </p>
        ) : null}

        {receipt ? <ConsensusReceiptSummary receipt={receipt} reward={reward ?? null}
          rewardUrl={`/wallet/reward/${encodeURIComponent(code)}?email=${encodeURIComponent(email.trim())}`}
          onClaimReward={PUBLIC_SHOWCASE.enabled && reward && operations?.rewardAvailable
            ? () => void handleRewardClaim()
            : undefined}
          claimAvailable={!PUBLIC_SHOWCASE.enabled || operations?.rewardAvailable === true}
          onDownloadJson={() => download(`${receipt.publicId}.json`, receipt.canonicalJson, 'application/json')}
          onDownloadProof={() => {
            if (!receipt.proofBase64) return;
            const binary = atob(receipt.proofBase64);
            const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
            download(`${receipt.publicId}.json.ots`, bytes, 'application/octet-stream');
          }}
        /> : null}

        {PUBLIC_SHOWCASE.enabled && publicRefund?.refundablePaymentCount ? (
          <section className="mt-6 rounded-xl border border-stone-200 p-4" aria-labelledby="public-refund-heading">
            <h2 id="public-refund-heading" className="font-semibold text-stone-900">
              Project contribution refund
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              Zaprite and Wavelength refunds are handled manually. The payment
              remains paid until staff records the external refund reference.
            </p>
            {publicRefund.completedCaseCount > 0 ? (
              <p role="status" className="mt-3 text-sm font-medium text-emerald-700">
                Refund completed by staff.
              </p>
            ) : publicRefund.requestedCaseCount > 0 ? (
              <p role="status" className="mt-3 text-sm font-medium text-amber-800">
                Refund requested. Staff resolution is pending.
              </p>
            ) : (
              <button
                type="button"
                className="btn-secondary mt-4"
                disabled={requestingRefund}
                onClick={() => void handlePublicRefundRequest()}
              >
                {requestingRefund ? 'Requesting…' : 'Request contribution refund'}
              </button>
            )}
          </section>
        ) : null}

        {result ? (
          <div className="mt-6 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <p className="font-medium">Booking cancelled.</p>
            <p className="mt-1">
              Paid before cancellation: {formatMoney(result.paidCents, booking?.currency)} · Refund amount: {formatMoney(result.refundCents, booking?.currency)}
            </p>
            {result.refundCents > 0 ? (
              <p className="mt-1">
                The payment timeline above shows whether the refund is complete or requires staff action.
              </p>
            ) : <p className="mt-1">No refund is due under the cancellation policy.</p>}
          </div>
        ) : cancellable ? (
          <div className="mt-6 border-t border-stone-200 pt-6">
            <h2 className="text-lg font-semibold text-stone-900">Cancellation</h2>
            <p className="mt-1 text-sm text-stone-500">
              {email.includes('@')
                ? 'This action uses the booking email entered above.'
                : 'Enter the booking email above to enable cancellation.'}
            </p>

            {error ? (
              <div className="mt-3">
                <ErrorMessage message={error} />
              </div>
            ) : null}

            {!showConfirm ? (
              <button
                type="button"
                className="btn-secondary mt-4 w-full border-red-200 text-red-700 hover:border-red-300 hover:bg-red-50"
                disabled={!email.includes('@')}
                onClick={() => setShowConfirm(true)}
              >
                Cancel booking
              </button>
            ) : (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
                <p className="text-sm text-red-800">
                  Refund amount is determined by the cancellation policy for your stay. Are you sure you want to
                  cancel?
                </p>
                <div className="mt-3 flex gap-2">
                  <button type="button" className="btn-secondary flex-1" onClick={() => setShowConfirm(false)}>
                    Keep booking
                  </button>
                  <button
                    type="button"
                    className="btn-primary flex-1 !bg-red-700 hover:!bg-red-800"
                    disabled={cancelling}
                    onClick={handleCancel}
                  >
                    {cancelling ? 'Cancelling…' : 'Yes, cancel'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-6 text-sm text-stone-500">This booking can no longer be modified here.</p>
        )}
      </div>
    </div>
  );
}
