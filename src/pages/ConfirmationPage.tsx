import { Link, useParams } from 'react-router-dom';
import { useQuery } from 'convex/react';
import { PartyPopper } from 'lucide-react';

import { api } from '../../convex/_generated/api';
import { Spinner } from '../components/Spinner';
import { PriceBreakdownView } from '../components/PriceBreakdownView';
import { formatDisplayDate } from '../lib/dates';
import { NotFoundPage } from './NotFoundPage';

/**
 * NEVER trust navigation state here — only the reactive query result decides
 * what's shown (CLAUDE.md convention #9). A 'hold' status means the payment
 * mutation hasn't landed yet (still finalizing); render accordingly.
 */
export function ConfirmationPage() {
  const { code } = useParams<{ code: string }>();
  const booking = useQuery(api.bookings.byConfirmationCode, code ? { code } : 'skip');

  if (!code) return <NotFoundPage />;
  if (booking === undefined) return <Spinner label="Loading your confirmation…" />;
  if (booking === null) return <NotFoundPage />;

  if (booking.status === 'hold') {
    return <Spinner label="Finalizing your booking…" />;
  }

  if (booking.status === 'expired' || booking.status === 'cancelled') {
    return (
      <div className="card p-8 text-center">
        <h1 className="text-2xl font-semibold text-stone-900">
          {booking.status === 'expired' ? 'This hold expired' : 'This booking was cancelled'}
        </h1>
        <p className="mt-2 text-stone-500">
          {booking.status === 'expired'
            ? 'The dates were released. Please start a new booking.'
            : 'If this was a mistake, please start a new booking or contact us.'}
        </p>
        <Link to="/" className="btn-primary mt-6 inline-flex">
          Back to home
        </Link>
      </div>
    );
  }

  if (booking.status !== 'confirmed') {
    return (
      <div className="card p-8 text-center">
        <h1 className="text-2xl font-semibold text-stone-900">Booking status: {booking.status.replace('_', ' ')}</h1>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="card p-8 text-center">
        <PartyPopper className="mx-auto h-10 w-10 text-emerald-700" aria-hidden="true" />
        <h1 className="mt-3 text-2xl font-semibold text-stone-900">You're all booked!</h1>
        <p className="mt-1 text-stone-500">
          Confirmation code <span className="font-mono font-semibold text-stone-900">{booking.confirmationCode}</span>
        </p>

        <dl className="mt-6 space-y-1 text-left text-sm text-stone-600">
          <div className="flex justify-between">
            <dt>Stay</dt>
            <dd className="font-medium text-stone-900">{booking.unitTypeName}</dd>
          </div>
          <div className="flex justify-between">
            <dt>Unit</dt>
            <dd>{booking.unitName}</dd>
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
          <div className="mt-6 border-t border-stone-200 pt-6 text-left">
            <PriceBreakdownView price={booking.priceBreakdown} nights={booking.nights} currency={booking.currency} taxLabel={booking.taxLabel} />
          </div>
        ) : null}

        <Link to={`/manage/${booking.confirmationCode}`} className="btn-secondary mt-6 inline-flex">
          Manage this booking
        </Link>
      </div>
    </div>
  );
}
