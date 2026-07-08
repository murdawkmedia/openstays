// Thin typed client over the OpenStays HTTP API v1.
//
// Contract source of truth: convex/apiV1.ts (header comment) + convex/apiKeys.ts
// in the main repo. Money stays integer cents; dates stay 'YYYY-MM-DD' strings
// (see CLAUDE.md conventions #1/#2) — this client never reinterprets either,
// it just passes them through.
//
// Auth: 'Authorization: Bearer osk_<48 hex>'. Success envelope: {data: T}.
// Error envelope: {error: {code, message}} with an HTTP 4xx/5xx status.

/** Thrown for any non-2xx response. Carries the server's error code + message. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export interface OpenStaysClientOptions {
  /** Deployment's HTTP Actions origin, e.g. https://happy-animal-123.convex.site */
  baseUrl: string;
  /** Raw API key, format 'osk_' + 48 hex chars. */
  apiKey: string;
  /** Override global fetch (mainly for tests). */
  fetchImpl?: typeof fetch;
}

export interface HealthResult {
  ok: boolean;
  version: string;
}

/** Wire shape of GET /properties (api.properties.listActive — active properties only). */
export interface Property {
  propertyId: string;
  name: string;
  slug: string;
  address?: string;
}

export interface UnitType {
  unitTypeId: string;
  name: string;
  slug: string;
  kind: string;
  maxOccupancy?: number;
  comingSoon?: boolean;
  sortOrder?: number;
}

export interface Unit {
  unitId: string;
  unitTypeId: string;
  name: string;
  slug: string;
  status: 'active' | 'coming_soon' | 'offline';
  bookableFrom?: string;
  sortOrder?: number;
}

export interface RatePlan {
  ratePlanId: string;
  name: string;
  currency: string;
  baseNightlyCents: number;
  weeklyRateCents?: number;
  seasons?: unknown[];
  minStayNights?: number;
  maxStayNights?: number;
  minLeadTimeHours?: number;
  maxAdvanceDays?: number;
  prepBufferNights?: number;
  depositPolicy?: unknown;
  cancellationPolicy?: unknown;
}

/** Wire shape of GET /rate-plans — the unit type id plus its active plans. */
export interface RatePlansResult {
  unitTypeId: string;
  ratePlans: RatePlan[];
}

export interface AvailabilityUnit {
  unitId: string;
  unitName: string;
  unitSlug: string;
  bookableFrom?: string;
  blockedDates: string[];
}

export interface AvailabilityResult {
  units: AvailabilityUnit[];
  startDate: string;
  endDate: string;
}

export interface TapeBooking {
  bookingId: string;
  unitId: string;
  checkIn: string;
  checkOut: string;
  status: BookingStatus;
  confirmationCode: string;
  source: string;
}

export interface TapeResult {
  startDate: string;
  endDate: string;
  units: Array<{ unitId: string; name: string; status: string }>;
  bookings: TapeBooking[];
}

export type BookingStatus =
  | 'hold'
  | 'confirmed'
  | 'checked_in'
  | 'checked_out'
  | 'cancelled'
  | 'expired'
  | 'no_show'
  | 'external'
  | 'blocked'
  | 'payment_conflict';

export interface PriceBreakdown {
  nightlySubtotalCents: number;
  addOnSubtotalCents: number;
  promoDiscountCents: number;
  taxableSubtotalCents: number;
  gstCents: number;
  totalCents: number;
  giftCertAppliedCents: number;
  depositDueCents: number;
  balanceDueCents: number;
}

export interface BookingSummary {
  bookingId: string;
  unitId: string;
  checkIn: string;
  checkOut: string;
  status: BookingStatus;
  confirmationCode: string;
  source: string;
}

export interface BookingDetail {
  currency: string;
  taxLabel?: string;
  status: BookingStatus;
  confirmationCode: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  adults: number;
  children: number;
  holdExpiresAt?: number;
  priceBreakdown?: PriceBreakdown;
  promoCode?: string;
  unitName: string;
  unitTypeName: string;
  addOns: Array<{ name: string; quantity: number; unitPriceCents: number }>;
}

export interface CreateHoldArgs {
  unitId: string;
  ratePlanId: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  guest: {
    name: string;
    email: string;
    phone: string;
    marketingOptIn: boolean;
  };
  addOns?: Array<{ addOnId: string; quantity: number }>;
  promoCode?: string;
}

export interface CreateHoldResult {
  bookingId: string;
  confirmationCode: string;
  price: PriceBreakdown;
  holdExpiresAt: number;
}

export interface CancelBookingResult {
  refundCents: number;
  paidCents: number;
}

export interface PromoPreviewArgs {
  property: string;
  unitType: string;
  code: string;
}

export type PromoPreviewResult =
  | {
      valid: true;
      code: string;
      kind: string;
      valueBps?: number;
      valueCents?: number;
      minSubtotalCents?: number;
      description?: string;
    }
  | { valid: false; reason: string };

export interface ListBookingsArgs {
  status?: BookingStatus;
  from?: string;
  to?: string;
  limit?: number;
}

export interface AvailabilityArgs {
  property: string;
  unitType: string;
  from: string;
  to: string;
}

export interface TapeArgs {
  property: string;
  from: string;
  to: string;
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export class OpenStaysClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenStaysClientOptions) {
    if (!options.baseUrl) throw new Error('OpenStaysClient: baseUrl is required');
    if (!options.apiKey) throw new Error('OpenStaysClient: apiKey is required');
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}/api/v1${path}`;
    const response = await this.fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ApiError(
        response.status,
        'INVALID_RESPONSE',
        `Non-JSON response from ${url} (status ${response.status})`,
      );
    }

    const parsed = payload as { data?: T; error?: { code: string; message: string } };

    if (!response.ok || parsed.error) {
      const err = parsed.error ?? { code: 'UNKNOWN_ERROR', message: `Request failed with status ${response.status}` };
      throw new ApiError(response.status, err.code, err.message);
    }

    return parsed.data as T;
  }

  health(): Promise<HealthResult> {
    return this.request<HealthResult>('GET', '/health');
  }

  listProperties(): Promise<Property[]> {
    return this.request<Property[]>('GET', '/properties');
  }

  listUnitTypes(args: { property: string }): Promise<UnitType[]> {
    return this.request<UnitType[]>('GET', `/unit-types${buildQuery({ property: args.property })}`);
  }

  listUnits(args: { property: string }): Promise<Unit[]> {
    return this.request<Unit[]>('GET', `/units${buildQuery({ property: args.property })}`);
  }

  listRatePlans(args: { property: string; unitType: string }): Promise<RatePlansResult> {
    return this.request<RatePlansResult>(
      'GET',
      `/rate-plans${buildQuery({ property: args.property, unitType: args.unitType })}`,
    );
  }

  availability(args: AvailabilityArgs): Promise<AvailabilityResult> {
    return this.request<AvailabilityResult>(
      'GET',
      `/availability${buildQuery({
        property: args.property,
        unitType: args.unitType,
        from: args.from,
        to: args.to,
      })}`,
    );
  }

  tape(args: TapeArgs): Promise<TapeResult> {
    return this.request<TapeResult>(
      'GET',
      `/tape${buildQuery({ property: args.property, from: args.from, to: args.to })}`,
    );
  }

  listBookings(args: ListBookingsArgs = {}): Promise<BookingSummary[]> {
    return this.request<BookingSummary[]>(
      'GET',
      `/bookings${buildQuery({
        status: args.status,
        from: args.from,
        to: args.to,
        limit: args.limit,
      })}`,
    );
  }

  getBooking(code: string): Promise<BookingDetail> {
    return this.request<BookingDetail>('GET', `/bookings/${encodeURIComponent(code)}`);
  }

  createHold(args: CreateHoldArgs): Promise<CreateHoldResult> {
    return this.request<CreateHoldResult>('POST', '/bookings/hold', args);
  }

  cancelBooking(code: string, args: { email: string }): Promise<CancelBookingResult> {
    return this.request<CancelBookingResult>(
      'POST',
      `/bookings/${encodeURIComponent(code)}/cancel`,
      args,
    );
  }

  promoPreview(args: PromoPreviewArgs): Promise<PromoPreviewResult> {
    return this.request<PromoPreviewResult>('POST', '/promo-codes/preview', args);
  }
}
