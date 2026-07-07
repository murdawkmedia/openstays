import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from 'convex/react';
import { Clock } from 'lucide-react';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { Spinner } from '../components/Spinner';
import { ErrorMessage, extractErrorMessage } from '../components/ErrorMessage';
import { PriceBreakdownView } from '../components/PriceBreakdownView';
import { formatCountdown, formatDisplayDate } from '../lib/dates';
import { NotFoundPage } from './NotFoundPage';

/**
 * Checkout reads the confirmation code from the query string but treats it
 * only as a lookup key — the reactive query result is the sole source of
 * truth for booking state (CLAUDE.md convention #9).
 */
export function CheckoutPage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const [searchParams] = useSearchParams();
  const code = searchParams.get('code');
  const navigate = useNavigate();

  const booking = useQuery(api.bookings.byConfirmationCode, code ? { code } : 'skip');
  const confirmSimulated = useMutation(api.bookings.confirmSimulated);

  const [now, setNow] = useState(() => Date.now());
  const [payError, setPayError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (booking?.status === 'confirmed') {
      navigate(`/confirmation/${booking.confirmationCode}`, { replace: true });
    }
  }, [booking, navigate]);

  if (!bookingId || !code) return <NotFoundPage />;
  if (booking === undefined) return <Spinner label="Loading your booking…" />;
  if (booking === null) return <NotFoundPage />;

  if (booking.status !== 'hold') {
    return (
      <div className="card p-8 text-center">
        <h1 className="text-2xl font-semibold text-stone-900">This hold is no longer active</h1>
        <p className="mt-2 text-stone-500">Status: {booking.status.replace('_', ' ')}</p>
      </div>
    );
  }

  const msRemaining = (booking.holdExpiresAt ?? now) - now;
  const expired = msRemaining <= 0;

  async function handlePay() {
    setPaying(true);
    setPayError(null);
    try {
      await confirmSimulated({ bookingId: bookingId as Id<'bookings'> });
      // Navigation happens reactively once the query reflects 'confirmed'.
    } catch (error) {
      setPayError(extractErrorMessage(error));
    } finally {
      setPaying(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="card p-8">
        <h1 className="text-2xl font-semibold text-stone-900">Complete your booking</h1>

        <div className="mt-4 flex items-center gap-2 rounded-lg bg-amber-50 px-4 py-3 text-amber-800">
          <Clock className="h-4 w-4" aria-hidden="true" />
          {expired ? (
            <span className="text-sm font-medium">Your hold has expired. Please start over.</span>
          ) : (
            <span className="text-sm font-medium">Dates held for {formatCountdown(msRemaining)}</span>
          )}
        </div>

        <dl className="mt-6 space-y-1 text-sm text-stone-600">
          <div className="flex justify-between">
            <dt>Stay</dt>
            <dd className="font-medium text-stone-900">{booking.unitTypeName}</dd>
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

        {booking.priceBreakdown ? (
          <div className="mt-6 border-t border-stone-200 pt-6">
            <PriceBreakdownView price={booking.priceBreakdown} nights={booking.nights} />
          </div>
        ) : null}

        {payError ? (
          <div className="mt-4">
            <ErrorMessage message={payError} />
          </div>
        ) : null}

        <button
          type="button"
          className="btn-primary mt-6 w-full"
          disabled={expired || paying}
          onClick={handlePay}
        >
          {paying ? 'Processing…' : 'Complete demo payment'}
        </button>
        <p className="mt-2 text-center text-xs text-stone-400">
          Demo mode — no real charge. Stripe &amp; Square checkout land in M1.
        </p>
      </div>
    </div>
  );
}
