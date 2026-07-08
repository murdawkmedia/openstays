import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAction, useMutation, useQuery } from 'convex/react';
import { Clock, CreditCard } from 'lucide-react';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { Spinner } from '../components/Spinner';
import { ErrorMessage, extractErrorMessage } from '../components/ErrorMessage';
import { PriceBreakdownView } from '../components/PriceBreakdownView';
import { formatCountdown, formatDisplayDate } from '../lib/dates';
import { NotFoundPage } from './NotFoundPage';

const PROVIDER_LABELS: Record<string, string> = {
  stripe: 'Pay with card — Stripe',
  square: 'Pay with card — Square',
};

/**
 * Checkout reads the confirmation code from the query string but treats it
 * only as a lookup key — the reactive query result is the sole source of
 * truth for booking state (CLAUDE.md convention #9).
 *
 * The guest can land here two ways: fresh navigation from the unit page
 * (which sets ?code=...), or a bounce back from a provider's hosted
 * checkout "cancel" link. Either way this page must rehydrate purely from
 * the URL + the reactive query — no reliance on router/navigation state.
 */
export function CheckoutPage() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const [searchParams] = useSearchParams();
  const code = searchParams.get('code');
  const navigate = useNavigate();

  const booking = useQuery(api.bookings.byConfirmationCode, code ? { code } : 'skip');
  const providerInfo = useQuery(api.payments.checkout.availableProviders);
  // Single-operator-per-deployment (CLAUDE.md #8): configList always
  // describes the one property this deployment serves.
  const propertyConfigs = useQuery(api.properties.configList);
  const confirmSimulated = useMutation(api.bookings.confirmSimulated);
  const createCheckoutSession = useAction(api.payments.checkout.createCheckoutSession);

  const [now, setNow] = useState(() => Date.now());
  const [payError, setPayError] = useState<string | null>(null);
  const [holdTooStale, setHoldTooStale] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payingProvider, setPayingProvider] = useState<string | null>(null);

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
  const property = propertyConfigs?.[0];
  const demoMode = providerInfo?.demoMode ?? true;

  async function handleSimulatedPay() {
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

  async function handleProviderPay(provider: 'stripe' | 'square') {
    setPaying(true);
    setPayingProvider(provider);
    setPayError(null);
    setHoldTooStale(false);
    try {
      const result = await createCheckoutSession({ bookingId: bookingId as Id<'bookings'>, provider });
      window.location.assign(result.checkoutUrl);
      // Intentionally leave `paying` true — we're navigating away.
    } catch (error) {
      const code = extractErrorCode(error);
      if (code === 'HOLD_TOO_STALE') {
        setHoldTooStale(true);
      } else if (code === 'NOT_A_HOLD') {
        // The booking may have been confirmed by a webhook in the interim.
        // The reactive query is the source of truth: if it already shows
        // 'confirmed', go straight to the confirmation page; otherwise show
        // a generic message rather than guessing at a status we can't see.
        const status: string | undefined = booking?.status;
        if (status === 'confirmed' && booking?.confirmationCode) {
          navigate(`/confirmation/${booking.confirmationCode}`, { replace: true });
        } else {
          setPayError('This booking is no longer awaiting payment. Refresh to see its current status.');
        }
      } else if (code === 'PROVIDER_NOT_CONFIGURED') {
        setPayError('PROVIDER_NOT_CONFIGURED');
      } else {
        setPayError(extractErrorMessage(error));
      }
      setPaying(false);
      setPayingProvider(null);
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
            <PriceBreakdownView price={booking.priceBreakdown} nights={booking.nights} currency={booking.currency} taxLabel={booking.taxLabel} />
          </div>
        ) : null}

        {holdTooStale ? (
          <div className="mt-4">
            <ErrorMessage message="There isn't enough time left on this hold to start a card payment. Please rebook to get a fresh hold window." />
            <Link to="/" className="btn-secondary mt-3 inline-flex">
              Start a new booking
            </Link>
          </div>
        ) : payError === 'PROVIDER_NOT_CONFIGURED' ? (
          <div className="mt-4">
            <ErrorMessage
              message={
                property
                  ? `Online payment isn't configured yet. Please contact ${property.name} at ${property.email} or ${property.phone} to complete this booking.`
                  : "Online payment isn't configured yet. Please contact the property to complete this booking."
              }
            />
          </div>
        ) : payError ? (
          <div className="mt-4">
            <ErrorMessage message={payError} />
          </div>
        ) : null}

        {demoMode ? (
          <>
            <button
              type="button"
              className="btn-primary mt-6 w-full"
              disabled={expired || paying}
              onClick={handleSimulatedPay}
            >
              {paying ? 'Processing…' : 'Complete demo payment'}
            </button>
            <p className="mt-2 text-center text-xs text-stone-400">
              Demo mode — no real charge. Stripe &amp; Square checkout land in M1.
            </p>
          </>
        ) : providerInfo === undefined || propertyConfigs === undefined ? (
          <div className="mt-6">
            <Spinner label="Loading payment options…" />
          </div>
        ) : providerInfo.providers.length === 0 ? (
          <div className="mt-6 rounded-lg bg-stone-50 px-4 py-3 text-sm text-stone-600">
            Online payment isn't configured for this property yet.{' '}
            {property ? (
              <>
                Please contact them at{' '}
                <a className="font-medium text-emerald-700 underline" href={`mailto:${property.email}`}>
                  {property.email}
                </a>{' '}
                or {property.phone} to complete your booking.
              </>
            ) : (
              'Please contact the property to complete your booking.'
            )}
          </div>
        ) : (
          <div className={`mt-6 grid gap-3 ${providerInfo.providers.length > 1 ? 'sm:grid-cols-2' : ''}`}>
            {providerInfo.providers.map((provider) => (
              <button
                key={provider}
                type="button"
                className="btn-primary flex w-full items-center justify-center gap-2"
                disabled={expired || paying}
                onClick={() => handleProviderPay(provider)}
              >
                <CreditCard className="h-4 w-4" aria-hidden="true" />
                {paying && payingProvider === provider ? 'Redirecting…' : PROVIDER_LABELS[provider] ?? `Pay with ${provider}`}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Convex actions surface ConvexError via `error.data` (same shape as
 * mutations). We use the same {code, message} object as the rest of the
 * codebase (see convex/bookings.ts ConvexError calls) — extract just the code.
 */
function extractErrorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: unknown }).data;
    if (typeof data === 'string') return data;
    if (data && typeof data === 'object' && 'code' in data) {
      const code = (data as { code?: unknown }).code;
      if (typeof code === 'string') return code;
    }
  }
  return null;
}
