// Pure pricing, date, and stay-rule logic shared by the client (preview) and
// Convex mutations (authoritative). NO imports from convex/ or src/ — this
// module must stay dependency-free and side-effect-free.
//
// Binding conventions (see CLAUDE.md):
// - Money is integer cents. Never floats.
// - Stay dates are property-local ISO 'YYYY-MM-DD' strings. Lexicographic
//   comparison == chronological comparison.
// - Nights are half-open ranges [checkIn, checkOut) — checkout day is free
//   for the next check-in.

export interface RatePlanSeason {
  label: string;
  startDate: string; // inclusive
  endDate: string; // inclusive
  nightlyCents: number;
  minStayNights?: number;
}

export interface DepositPolicy {
  type: 'full' | 'percent' | 'flat' | 'first_night';
  value: number; // percent 0-100 for 'percent', cents for 'flat', ignored otherwise
}

export interface CancellationWindow {
  daysBefore: number; // applies when daysUntilCheckIn >= daysBefore
  refundPercent: number; // 0-100 of the amount paid
}

export interface RatePlanLike {
  baseNightlyCents: number;
  weeklyRateCents?: number;
  seasons: RatePlanSeason[];
  minStayNights: number;
  maxStayNights: number;
  minLeadTimeHours: number;
  maxAdvanceDays: number;
  prepBufferNights: number;
  depositPolicy: DepositPolicy;
  cancellationPolicy: CancellationWindow[];
}

export interface AddOnLine {
  name: string;
  unitPriceCents: number;
  quantity: number;
  taxable: boolean;
}

export interface PromoLike {
  kind: 'percent' | 'fixed';
  valueBps?: number; // percent: basis points (2000 = 20%)
  valueCents?: number; // fixed: cents off
}

/**
 * Accounting distinction (binding — see CLAUDE.md):
 * - A PROMO CODE is a pre-tax price reduction. GST is charged on the
 *   discounted base, exactly like any merchant discount in Canada.
 * - A GIFT CERTIFICATE is a post-tax payment method. GST is charged on the
 *   full (post-promo) amount; the certificate pays down the total.
 */
export interface PriceBreakdown {
  nightlySubtotalCents: number;
  addOnSubtotalCents: number;
  promoDiscountCents: number; // pre-tax reduction
  taxableSubtotalCents: number; // (taxable items − promo allocation)
  gstCents: number; // single rounding on the discounted taxable base
  totalCents: number; // subtotals − promo + gst (the invoice total)
  giftCertAppliedCents: number; // post-tax payment
  depositDueCents: number; // computed on total − giftCertApplied
  balanceDueCents: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/** Add days to an ISO date string (UTC arithmetic — safe because inputs are date-only). */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Whole days between two ISO dates (b - a). */
export function daysBetween(a: string, b: string): number {
  const toDay = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 86_400_000;
  };
  return toDay(b) - toDay(a);
}

/** Every night of a half-open range [start, end) as ISO strings. */
export function enumerateNights(start: string, end: string): string[] {
  const nights: string[] = [];
  for (let d = start; d < end; d = addDays(d, 1)) nights.push(d);
  return nights;
}

/** Today's date in a property's timezone as an ISO string. */
export function todayInTimezone(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now); // en-CA gives YYYY-MM-DD
}

export class StayRuleError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_DATES'
      | 'MIN_STAY'
      | 'MAX_STAY'
      | 'LEAD_TIME'
      | 'ADVANCE_WINDOW',
    message: string,
  ) {
    super(message);
    this.name = 'StayRuleError';
  }
}

/** Throws StayRuleError when the requested stay violates the rate plan's rules. */
export function validateStayRules(
  ratePlan: RatePlanLike,
  checkIn: string,
  checkOut: string,
  timezone: string,
  now: Date = new Date(),
): void {
  if (!isIsoDate(checkIn) || !isIsoDate(checkOut) || checkOut <= checkIn) {
    throw new StayRuleError('INVALID_DATES', 'Check-out must be after check-in.');
  }
  const nights = daysBetween(checkIn, checkOut);
  const minStay = effectiveMinStay(ratePlan, checkIn);
  if (nights < minStay) {
    throw new StayRuleError('MIN_STAY', `Minimum stay is ${minStay} nights for these dates.`);
  }
  if (nights > ratePlan.maxStayNights) {
    throw new StayRuleError('MAX_STAY', `Maximum stay is ${ratePlan.maxStayNights} nights.`);
  }
  const today = todayInTimezone(timezone, now);
  if (checkIn < today) {
    throw new StayRuleError('LEAD_TIME', 'Check-in date is in the past.');
  }
  if (ratePlan.minLeadTimeHours > 0) {
    const leadDays = Math.ceil(ratePlan.minLeadTimeHours / 24);
    if (daysBetween(today, checkIn) < leadDays) {
      throw new StayRuleError(
        'LEAD_TIME',
        `Bookings require at least ${ratePlan.minLeadTimeHours} hours notice.`,
      );
    }
  }
  if (daysBetween(today, checkIn) > ratePlan.maxAdvanceDays) {
    throw new StayRuleError(
      'ADVANCE_WINDOW',
      `Bookings open ${ratePlan.maxAdvanceDays} days before arrival.`,
    );
  }
}

function effectiveMinStay(ratePlan: RatePlanLike, checkIn: string): number {
  const season = findSeason(ratePlan.seasons, checkIn);
  return season?.minStayNights ?? ratePlan.minStayNights;
}

/** First season whose [startDate, endDate] (inclusive) contains the date. */
export function findSeason(seasons: RatePlanSeason[], date: string): RatePlanSeason | undefined {
  return seasons.find((s) => s.startDate <= date && date <= s.endDate);
}

/** Nightly rate for one specific night. */
export function nightlyRateCents(ratePlan: RatePlanLike, night: string): number {
  return findSeason(ratePlan.seasons, night)?.nightlyCents ?? ratePlan.baseNightlyCents;
}

export interface ComputePriceInput {
  ratePlan: RatePlanLike;
  checkIn: string;
  checkOut: string;
  addOns: AddOnLine[];
  taxRateBps: number; // 500 = 5% GST
  /** Pre-validated promo (scope/window/caps checked by the caller). */
  promo?: PromoLike;
  giftBalanceCents?: number;
}

/** Discount a promo grants against an eligible pre-tax subtotal. Never negative. */
export function computePromoDiscountCents(promo: PromoLike, eligibleSubtotalCents: number): number {
  if (eligibleSubtotalCents <= 0) return 0;
  if (promo.kind === 'percent') {
    const bps = Math.max(0, Math.min(10_000, promo.valueBps ?? 0));
    return Math.round((eligibleSubtotalCents * bps) / 10_000);
  }
  return Math.max(0, Math.min(promo.valueCents ?? 0, eligibleSubtotalCents));
}

/**
 * Authoritative price computation.
 * GST is rounded ONCE on the aggregate taxable base (CRA-consistent).
 * Promo codes reduce the PRE-tax base (allocated proportionally across
 * taxable / non-taxable items so the taxable base shrinks correctly).
 * Gift certificates apply POST-tax as a payment against the total.
 */
export function computePrice(input: ComputePriceInput): PriceBreakdown {
  const nights = enumerateNights(input.checkIn, input.checkOut);
  let nightlySubtotalCents = nights.reduce(
    (sum, night) => sum + nightlyRateCents(input.ratePlan, night),
    0,
  );

  // Weekly rate: applied per full 7-night block when cheaper than the sum of
  // those nights at nightly rates. Remaining nights stay nightly.
  const weekly = input.ratePlan.weeklyRateCents;
  if (weekly !== undefined && nights.length >= 7) {
    const fullWeeks = Math.floor(nights.length / 7);
    let discounted = 0;
    for (let w = 0; w < fullWeeks; w += 1) {
      const block = nights.slice(w * 7, w * 7 + 7);
      const blockNightly = block.reduce(
        (sum, night) => sum + nightlyRateCents(input.ratePlan, night),
        0,
      );
      discounted += Math.min(blockNightly, weekly);
    }
    const remainder = nights
      .slice(fullWeeks * 7)
      .reduce((sum, night) => sum + nightlyRateCents(input.ratePlan, night), 0);
    nightlySubtotalCents = discounted + remainder;
  }

  const taxableAddOns = input.addOns
    .filter((a) => a.taxable)
    .reduce((sum, a) => sum + a.unitPriceCents * a.quantity, 0);
  const nonTaxableAddOns = input.addOns
    .filter((a) => !a.taxable)
    .reduce((sum, a) => sum + a.unitPriceCents * a.quantity, 0);
  const addOnSubtotalCents = taxableAddOns + nonTaxableAddOns;

  const preDiscountSubtotal = nightlySubtotalCents + addOnSubtotalCents;

  // Promo: pre-tax reduction on the whole booking subtotal (unit-type scope
  // eligibility is validated by the caller before passing `promo` in).
  const promoDiscountCents = input.promo
    ? computePromoDiscountCents(input.promo, preDiscountSubtotal)
    : 0;

  // Allocate the promo proportionally so the taxable base shrinks correctly
  // when the booking mixes taxable and non-taxable items.
  const preDiscountTaxable = nightlySubtotalCents + taxableAddOns;
  const taxableShareOfPromo =
    preDiscountSubtotal === 0
      ? 0
      : Math.round((promoDiscountCents * preDiscountTaxable) / preDiscountSubtotal);
  const taxableSubtotalCents = Math.max(0, preDiscountTaxable - taxableShareOfPromo);

  const gstCents = Math.round((taxableSubtotalCents * input.taxRateBps) / 10_000);
  const totalCents = preDiscountSubtotal - promoDiscountCents + gstCents;

  // Gift certificate: post-tax payment against the invoice total.
  const giftCertAppliedCents = Math.max(0, Math.min(input.giftBalanceCents ?? 0, totalCents));
  const netDueCents = totalCents - giftCertAppliedCents;

  const depositDueCents = computeDeposit(
    input.ratePlan,
    netDueCents,
    input.checkIn,
    input.taxRateBps,
  );

  return {
    nightlySubtotalCents,
    addOnSubtotalCents,
    promoDiscountCents,
    taxableSubtotalCents,
    gstCents,
    totalCents,
    giftCertAppliedCents,
    depositDueCents,
    balanceDueCents: netDueCents - depositDueCents,
  };
}

/** Deposit is computed on the net amount due (total − gift cert applied). */
function computeDeposit(
  ratePlan: RatePlanLike,
  netDueCents: number,
  checkIn: string,
  taxRateBps: number,
): number {
  const policy = ratePlan.depositPolicy;
  switch (policy.type) {
    case 'full':
      return netDueCents;
    case 'percent':
      return Math.min(netDueCents, Math.round((netDueCents * policy.value) / 100));
    case 'flat':
      return Math.min(netDueCents, policy.value);
    case 'first_night': {
      const firstNight = nightlyRateCents(ratePlan, checkIn);
      const withTax = firstNight + Math.round((firstNight * taxRateBps) / 10_000);
      return Math.min(netDueCents, withTax);
    }
  }
}

/** Refund for a cancellation: percentage of the amount paid, by policy window. */
export function computeRefundCents(
  policy: CancellationWindow[],
  paidCents: number,
  daysUntilCheckIn: number,
): number {
  // Windows sorted descending by daysBefore; first match wins.
  const sorted = [...policy].sort((a, b) => b.daysBefore - a.daysBefore);
  for (const window of sorted) {
    if (daysUntilCheckIn >= window.daysBefore) {
      return Math.round((paidCents * window.refundPercent) / 100);
    }
  }
  return 0;
}

/** Short human-friendly confirmation code, e.g. 'OS-7K3M2Q'. */
export function generateConfirmationCode(randomInt: (max: number) => number): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
  let code = '';
  for (let i = 0; i < 6; i += 1) code += alphabet[randomInt(alphabet.length)];
  return `OS-${code}`;
}
