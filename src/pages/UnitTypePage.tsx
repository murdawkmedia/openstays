import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from 'convex/react';
import { Users } from 'lucide-react';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { computePrice, enumerateNights, type RatePlanLike } from '../../shared/pricing';
import { checkoutPath } from '../../shared/bookingLinks';
import { Spinner } from '../components/Spinner';
import { ErrorMessage, extractErrorMessage } from '../components/ErrorMessage';
import { StayDateRangePicker } from '../components/StayDateRangePicker';
import { AddOnPicker } from '../components/AddOnPicker';
import { GuestForm, type GuestFormValue } from '../components/GuestForm';
import { PriceBreakdownView } from '../components/PriceBreakdownView';
import { StayMedia } from '../components/StayMedia';
import { formatMoney } from '../lib/money';
import { todayIso } from '../lib/dates';
import { NotFoundPage } from './NotFoundPage';

const AVAILABILITY_WINDOW_DAYS = 90;

export function UnitTypePage() {
  const { propertySlug, unitTypeSlug } = useParams<{ propertySlug: string; unitTypeSlug: string }>();
  const detail = useQuery(
    api.properties.unitTypeBySlug,
    propertySlug && unitTypeSlug ? { propertySlug, unitTypeSlug } : 'skip',
  );
  const availability = useQuery(
    api.availability.forUnitType,
    detail?.unitType
      ? { unitTypeId: detail.unitType.unitTypeId, startDate: todayIso(), days: AVAILABILITY_WINDOW_DAYS }
      : 'skip',
  );

  const [range, setRange] = useState<{ checkIn?: string; checkOut?: string }>({});
  const [addOnQuantities, setAddOnQuantities] = useState<Record<string, number>>({});
  const [guest, setGuest] = useState<GuestFormValue>({
    name: '',
    email: '',
    phone: '',
    marketingOptIn: false,
    adults: 1,
    children: 0,
  });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [promoInput, setPromoInput] = useState('');
  const [appliedPromo, setAppliedPromo] = useState<string | null>(null);

  const promoPreview = useQuery(
    api.promoCodes.preview,
    detail && appliedPromo
      ? {
          propertyId: detail.property.propertyId,
          unitTypeId: detail.unitType.unitTypeId,
          code: appliedPromo,
        }
      : 'skip',
  );

  const createHold = useMutation(api.bookings.createHold);
  const navigate = useNavigate();

  // A night is disabled in the picker only if EVERY unit is blocked that
  // night (a unit type can have multiple physical units).
  const fullyBlockedDates = useMemo(() => {
    if (!availability || availability.units.length === 0) return new Set<string>();
    const counts = new Map<string, number>();
    for (const unit of availability.units) {
      for (const date of unit.blockedDates) counts.set(date, (counts.get(date) ?? 0) + 1);
    }
    const blocked = new Set<string>();
    for (const [date, count] of counts) {
      if (count >= availability.units.length) blocked.add(date);
    }
    return blocked;
  }, [availability]);

  // First unit that is free (not blocked, and bookableFrom satisfied) for
  // every night of the selected [checkIn, checkOut) range.
  const availableUnitId = useMemo((): Id<'units'> | null => {
    if (!availability || !range.checkIn || !range.checkOut) return null;
    const nights = enumerateNights(range.checkIn, range.checkOut);
    for (const unit of availability.units) {
      if (unit.bookableFrom && range.checkIn < unit.bookableFrom) continue;
      const blocked = new Set(unit.blockedDates);
      if (nights.every((night) => !blocked.has(night))) {
        return unit.unitId as Id<'units'>;
      }
    }
    return null;
  }, [availability, range]);

  const addOnLines = useMemo(() => {
    if (!detail) return [];
    return detail.addOns
      .filter((a) => (addOnQuantities[a.addOnId] ?? 0) > 0)
      .map((a) => ({
        name: a.name,
        unitPriceCents: a.priceCents,
        quantity: addOnQuantities[a.addOnId],
        taxable: a.taxable,
      }));
  }, [detail, addOnQuantities]);

  // Base price (no promo) is needed to check min-spend before applying the
  // promo in the preview. Server-side createHold re-validates everything.
  const basePricePreview = useMemo(() => {
    if (!detail?.ratePlan || !range.checkIn || !range.checkOut) return null;
    return computePrice({
      ratePlan: detail.ratePlan as RatePlanLike,
      checkIn: range.checkIn,
      checkOut: range.checkOut,
      addOns: addOnLines,
      taxRateBps: detail.property.taxRateBps,
    });
  }, [detail, range, addOnLines]);

  const promoMinSpendShortfall =
    promoPreview?.valid &&
    promoPreview.minSubtotalCents !== undefined &&
    basePricePreview !== null &&
    basePricePreview.nightlySubtotalCents + basePricePreview.addOnSubtotalCents <
      promoPreview.minSubtotalCents
      ? promoPreview.minSubtotalCents
      : null;

  const promoActive = Boolean(promoPreview?.valid) && promoMinSpendShortfall === null;

  const pricePreview = useMemo(() => {
    if (!detail?.ratePlan || !range.checkIn || !range.checkOut) return null;
    return computePrice({
      ratePlan: detail.ratePlan as RatePlanLike,
      checkIn: range.checkIn,
      checkOut: range.checkOut,
      addOns: addOnLines,
      taxRateBps: detail.property.taxRateBps,
      promo:
        promoActive && promoPreview?.valid
          ? { kind: promoPreview.kind, valueBps: promoPreview.valueBps, valueCents: promoPreview.valueCents }
          : undefined,
    });
  }, [detail, range, addOnLines, promoActive, promoPreview]);

  if (!propertySlug || !unitTypeSlug) return <NotFoundPage />;
  if (detail === undefined) return <Spinner label="Loading stay details…" />;
  if (detail === null) return <NotFoundPage />;

  const { unitType, ratePlan, addOns } = detail;
  const fromPriceCents = ratePlan
    ? Math.min(ratePlan.baseNightlyCents, ...ratePlan.seasons.map((s) => s.nightlyCents), ratePlan.baseNightlyCents)
    : null;

  const nights = range.checkIn && range.checkOut ? enumerateNights(range.checkIn, range.checkOut).length : 0;
  const promoPlaceholder = detail.property.slug === 'consensus-commons' ? 'CONSENSUS10' : 'WELCOME10';

  const canSubmit =
    !!ratePlan &&
    !!range.checkIn &&
    !!range.checkOut &&
    !!availableUnitId &&
    guest.name.trim().length > 0 &&
    guest.email.includes('@') &&
    guest.phone.trim().length > 0 &&
    !submitting;

  async function handleSubmit() {
    if (!ratePlan || !range.checkIn || !range.checkOut || !availableUnitId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await createHold({
        unitId: availableUnitId,
        ratePlanId: ratePlan.ratePlanId,
        checkIn: range.checkIn,
        checkOut: range.checkOut,
        adults: guest.adults,
        children: guest.children,
        guest: {
          name: guest.name.trim(),
          email: guest.email.trim(),
          phone: guest.phone.trim(),
          marketingOptIn: guest.marketingOptIn,
        },
        addOns: Object.entries(addOnQuantities)
          .filter(([, quantity]) => quantity > 0)
          .map(([addOnId, quantity]) => ({ addOnId: addOnId as Id<'addOns'>, quantity })),
        promoCode: promoActive && appliedPromo ? appliedPromo : undefined,
      });
      navigate(checkoutPath(result.bookingId, result.confirmationCode));
    } catch (error) {
      setSubmitError(extractErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="card mb-8 p-8">
        <div className="mb-2 flex items-center gap-2">
          {unitType.comingSoon ? <span className="badge">Coming soon</span> : null}
        </div>
        <h1 className="text-3xl font-semibold text-stone-900">{unitType.name}</h1>
        <p className="mt-3 text-stone-600">{unitType.description}</p>
        <p className="mt-3 flex items-center gap-1.5 text-sm text-stone-500">
          <Users className="h-4 w-4" aria-hidden="true" />
          Sleeps up to {unitType.maxOccupancy}
        </p>
        <StayMedia
          propertySlug={detail.property.slug}
          propertyName={detail.property.name}
          amenities={unitType.amenities}
          photoUrls={unitType.photoUrls}
        />
        {fromPriceCents !== null ? (
          <p className="mt-4 text-lg font-semibold text-emerald-800">From {formatMoney(fromPriceCents, detail.property.currency)}/night</p>
        ) : null}
      </div>

      {unitType.comingSoon || !ratePlan ? (
        <div className="card p-8 text-center text-stone-600">
          <p>This stay isn't open for booking yet — check back soon.</p>
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="card p-6">
            <h2 className="mb-4 text-lg font-semibold text-stone-900">Choose your dates</h2>
            {availability === undefined ? (
              <Spinner label="Loading availability…" />
            ) : (
              <StayDateRangePicker fullyBlockedDates={fullyBlockedDates} range={range} onChange={setRange} />
            )}
            {range.checkIn && range.checkOut && !availableUnitId ? (
              <p className="mt-3 text-sm text-red-700">No units are free for the whole selected range. Try different dates.</p>
            ) : null}
          </div>

          <div className="space-y-6">
            <div className="card p-6">
              <AddOnPicker
                addOns={addOns}
                currency={detail.property.currency}
                selected={addOnQuantities}
                onChange={(addOnId, quantity) =>
                  setAddOnQuantities((prev) => ({ ...prev, [addOnId]: quantity }))
                }
              />
            </div>

            <div className="card p-6">
              <h2 className="mb-4 text-lg font-semibold text-stone-900">Discount code</h2>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="field-input flex-1"
                  placeholder={`e.g. ${promoPlaceholder}`}
                  aria-label="Discount code"
                  value={promoInput}
                  onChange={(event) => setPromoInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') setAppliedPromo(promoInput.trim() || null);
                  }}
                />
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setAppliedPromo(promoInput.trim() || null)}
                  disabled={promoInput.trim() === ''}
                >
                  Apply
                </button>
              </div>
              {appliedPromo && promoPreview !== undefined ? (
                promoPreview?.valid ? (
                  promoMinSpendShortfall !== null ? (
                    <p className="mt-2 text-sm text-amber-700">
                      {promoPreview.code} needs a subtotal of at least {formatMoney(promoMinSpendShortfall, detail.property.currency)} — add nights or extras to use it.
                    </p>
                  ) : (
                    <p className="mt-2 text-sm text-emerald-700">
                      {promoPreview.code} applied{promoPreview.description ? ` — ${promoPreview.description}` : ''}.{' '}
                      <button type="button" className="underline" onClick={() => { setAppliedPromo(null); setPromoInput(''); }}>
                        Remove
                      </button>
                    </p>
                  )
                ) : (
                  <p className="mt-2 text-sm text-red-700">That code isn't valid for this stay.</p>
                )
              ) : null}
            </div>

            <div className="card p-6">
              <h2 className="mb-4 text-lg font-semibold text-stone-900">Your details</h2>
              <GuestForm value={guest} onChange={setGuest} maxOccupancy={unitType.maxOccupancy} />
            </div>

            {pricePreview ? (
              <div className="card p-6">
                <h2 className="mb-4 text-lg font-semibold text-stone-900">Price preview</h2>
                <PriceBreakdownView price={pricePreview} nights={nights} currency={detail.property.currency} taxLabel={detail.property.taxLabel} />
              </div>
            ) : null}

            {submitError ? <ErrorMessage message={submitError} /> : null}

            <button type="button" className="btn-primary w-full" disabled={!canSubmit} onClick={handleSubmit}>
              {submitting ? 'Holding your dates…' : 'Continue to payment'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
