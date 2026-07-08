import { Link, useParams } from 'react-router-dom';
import { useQuery } from 'convex/react';
import { PartyPopper, ShieldAlert } from 'lucide-react';

import { api } from '../../convex/_generated/api';
import { Spinner } from '../components/Spinner';
import { PriceBreakdownView } from '../components/PriceBreakdownView';
import { formatDisplayDate } from '../lib/dates';
import { NotFoundPage } from './NotFoundPage';

/**
 * NEVER trust navigation state here — only the reactive query result decides
 * what's shown (CLAUDE.md convention #9). A 'hold' status means the payment
 * mutation/webhook hasn't landed yet (still finalizing); render accordingly.
 */
export function ConfirmationPage() {
  const { code } = useParams<{ code: string }>();
  const booking = useQuery(api.bookings.byConfirmationCode, code ? { code } : 'skip');
  // Single-operator-per-deployment (CLAUDE.md #8): configList always
  // describes the one property this deployment serves.
  const propertyConfigs = useQuery(api.properties.configList);

  if (!code) return <NotFoundPage />;
  if (booking === undefined) return <Spinner label="Loading your confirmation…" />;
  if (booking === null) return <NotFoundPage />;

  if (booking.status === 'hold') {
    // Real payment providers confirm asynchronously via webhook — the guest
    // can land here a few seconds before that lands. This is NOT an error
    // state; the query will flip to 'confirmed' (or 'payment_conflict') on
    // its own once the webhook processes.
    return <Spinner label="Finalizing your payment… this can take a few seconds." />;
  }

  if (booking.status === 'payment_conflict') {
    const property = propertyConfigs?.[0];
    return (
      <div className="card p-8 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-amber-600" aria-hidden="true" />
        <h1 className="mt-3 text-2xl font-semibold text-stone-900">We couldn't hold these dates</h1>
        <p className="mt-2 text-stone-500">
          Your payment came through after the hold on these dates had already lapsed, and someone else booked
          them in the meantime. We're very sorry for the mix-up — a full refund is on its way and should appear
          on your statement within a few business days.
        </p>
        {property ? (
          <p className="mt-4 text-sm text-stone-600">
            Questions? Contact {property.name} at{' '}
            <a className="font-medium text-emerald-700 underline" href={`mailto:${property.email}`}>
              {property.email}
            </a>{' '}
            or {property.phone}.
          </p>
        ) : null}
        <Link to="/" className="btn-primary mt-6 inline-flex">
          Back to home
        </Link>
      </div>
    );
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
