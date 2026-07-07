import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery } from 'convex/react';

import { api } from '../../convex/_generated/api';
import { Spinner } from '../components/Spinner';
import { ErrorMessage, extractErrorMessage } from '../components/ErrorMessage';
import { formatCad } from '../lib/money';
import { formatDisplayDate } from '../lib/dates';
import { NotFoundPage } from './NotFoundPage';

export function ManageBookingPage() {
  const { code } = useParams<{ code: string }>();
  const booking = useQuery(api.bookings.byConfirmationCode, code ? { code } : 'skip');
  const cancelByGuest = useMutation(api.bookings.cancelByGuest);

  const [email, setEmail] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ refundCents: number; paidCents: number } | null>(null);

  if (!code) return <NotFoundPage />;
  if (booking === undefined) return <Spinner label="Loading booking…" />;
  if (booking === null) return <NotFoundPage />;

  const cancellable = booking.status === 'confirmed' || booking.status === 'hold';

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

  return (
    <div className="mx-auto max-w-lg">
      <div className="card p-8">
        <h1 className="text-2xl font-semibold text-stone-900">Manage your booking</h1>
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

        {result ? (
          <div className="mt-6 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <p className="font-medium">Booking cancelled.</p>
            <p className="mt-1">
              Paid: {formatCad(result.paidCents)} · Refund: {formatCad(result.refundCents)}
            </p>
          </div>
        ) : cancellable ? (
          <div className="mt-6 border-t border-stone-200 pt-6">
            <label className="field-label" htmlFor="manage-email">
              Confirm your email to cancel
            </label>
            <input
              id="manage-email"
              type="email"
              className="field-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />

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
