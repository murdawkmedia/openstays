import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAction, useQuery } from 'convex/react';
import { Clock, CreditCard } from 'lucide-react';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { readGuestConfirmation } from '../../shared/bookingLinks';
import { ErrorMessage, extractErrorMessage } from '../components/ErrorMessage';
import { PriceBreakdownView } from '../components/PriceBreakdownView';
import { Spinner } from '../components/Spinner';
import { formatCountdown, formatDisplayDate } from '../lib/dates';
import { NotFoundPage } from './NotFoundPage';

const PROVIDER_LABELS: Record<string, string> = {
  stripe: 'Pay securely with Stripe',
  square: 'Pay securely with Square',
  zaprite: 'Pay with Zaprite',
};

export function ProductionCheckoutPage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const [searchParams] = useSearchParams();
  const [code] = useState(() => readGuestConfirmation(searchParams));
  const navigate = useNavigate();
  const booking = useQuery(api.bookings.forCheckout, bookingId && code
    ? { bookingId: bookingId as Id<'bookings'>, code }
    : 'skip');
  const providerInfo = useQuery(api.payments.checkout.availableProviders);
  const propertyConfigs = useQuery(api.properties.configList);
  const createCheckoutSession = useAction(api.payments.checkout.createCheckoutSession);
  const [now, setNow] = useState(() => Date.now());
  const [payingProvider, setPayingProvider] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [holdTooStale, setHoldTooStale] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, []);
  useEffect(() => {
    if (booking?.status === 'confirmed') navigate(`/confirmation/${booking.confirmationCode}`, { replace: true });
  }, [booking, navigate]);

  if (!bookingId || !code) return <NotFoundPage />;
  if (booking === undefined) return <Spinner label="Loading your booking…" />;
  if (booking === null) return <NotFoundPage />;
  if (booking.status !== 'hold') {
    return <div className="card p-8 text-center"><h1 className="text-2xl font-semibold">This hold is no longer active</h1><p className="mt-2 text-stone-500">Status: {booking.status.replace('_', ' ')}</p></div>;
  }

  const msRemaining = (booking.holdExpiresAt ?? now) - now;
  const expired = msRemaining <= 0;
  const property = propertyConfigs?.[0];

  async function pay(provider: 'stripe' | 'square' | 'zaprite') {
    setPayingProvider(provider);
    setPayError(null);
    setHoldTooStale(false);
    try {
      const result = await createCheckoutSession({
        bookingId: bookingId as Id<'bookings'>,
        provider,
        code: code ?? '',
      });
      window.location.assign(result.checkoutUrl);
    } catch (error) {
      const data = error && typeof error === 'object' && 'data' in error ? (error as { data?: unknown }).data : null;
      const errorCode = typeof data === 'string'
        ? data
        : data && typeof data === 'object' && 'code' in data ? String((data as { code: unknown }).code) : '';
      if (errorCode === 'HOLD_TOO_STALE') setHoldTooStale(true);
      else if (errorCode === 'PROVIDER_NOT_CONFIGURED') setPayError('PROVIDER_NOT_CONFIGURED');
      else setPayError(extractErrorMessage(error));
      setPayingProvider(null);
    }
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="card p-8">
        <h1 className="text-2xl font-semibold text-stone-900">Complete your booking</h1>
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-amber-50 px-4 py-3 text-amber-800">
          <Clock className="h-4 w-4" aria-hidden="true" />
          <span className="text-sm font-medium">{expired ? 'Your hold has expired. Please start over.' : `Dates held for ${formatCountdown(msRemaining)}`}</span>
        </div>
        <dl className="mt-6 space-y-1 text-sm text-stone-600">
          <div className="flex justify-between"><dt>Stay</dt><dd className="font-medium text-stone-900">{booking.unitTypeName}</dd></div>
          <div className="flex justify-between"><dt>Check-in</dt><dd>{formatDisplayDate(booking.checkIn)}</dd></div>
          <div className="flex justify-between"><dt>Check-out</dt><dd>{formatDisplayDate(booking.checkOut)}</dd></div>
        </dl>
        {booking.priceBreakdown ? <div className="mt-6 border-t border-stone-200 pt-6"><PriceBreakdownView price={booking.priceBreakdown} nights={booking.nights} currency={booking.currency} taxLabel={booking.taxLabel} /></div> : null}
        {holdTooStale ? <div className="mt-4"><ErrorMessage message="There is not enough time left on this hold to start payment. Please rebook for a fresh hold." /><Link to="/" className="btn-secondary mt-3 inline-flex">Start a new booking</Link></div> : null}
        {payError === 'PROVIDER_NOT_CONFIGURED' ? <div className="mt-4"><ErrorMessage message={property ? `Online payment is not configured yet. Please contact ${property.name} at ${property.email} or ${property.phone}.` : 'Online payment is not configured yet. Please contact the property.'} /></div> : payError ? <div className="mt-4"><ErrorMessage message={payError} /></div> : null}
        {providerInfo === undefined || propertyConfigs === undefined ? <div className="mt-6"><Spinner label="Loading payment options…" /></div> : providerInfo.providers.length === 0 ? (
          <p className="mt-6 rounded-lg bg-stone-50 px-4 py-3 text-sm text-stone-600">Online payment is not configured for this property yet.</p>
        ) : (
          <div className={`mt-6 grid gap-3 ${providerInfo.providers.length > 1 ? 'sm:grid-cols-2' : ''}`}>
            {providerInfo.providers.map((provider) => (
              <button key={provider} type="button" className="btn-primary flex w-full items-center justify-center gap-2" disabled={expired || payingProvider !== null} onClick={() => void pay(provider)}>
                <CreditCard className="h-4 w-4" aria-hidden="true" />
                {payingProvider === provider ? 'Redirecting…' : PROVIDER_LABELS[provider] ?? `Pay with ${provider}`}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
