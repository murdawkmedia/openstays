import { describe, expect, it, vi } from 'vitest';
import { ApiError, OpenStaysClient } from './client.js';

function makeFetch(response: { status: number; body: unknown }) {
  return vi.fn(async (_url: string, _init?: RequestInit) => {
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.body,
    } as unknown as Response;
  });
}

describe('OpenStaysClient', () => {
  it('requires baseUrl and apiKey', () => {
    expect(() => new OpenStaysClient({ baseUrl: '', apiKey: 'osk_x' })).toThrow();
    expect(() => new OpenStaysClient({ baseUrl: 'https://x.convex.site', apiKey: '' })).toThrow();
  });

  it('parses the {data} envelope on success', async () => {
    const fetchImpl = makeFetch({ status: 200, body: { data: { ok: true, version: '1.0' } } });
    const client = new OpenStaysClient({
      baseUrl: 'https://example.convex.site',
      apiKey: 'osk_abc',
      fetchImpl,
    });
    const result = await client.health();
    expect(result).toEqual({ ok: true, version: '1.0' });
  });

  it('sends the Authorization Bearer header', async () => {
    const fetchImpl = makeFetch({ status: 200, body: { data: { ok: true, version: '1.0' } } });
    const client = new OpenStaysClient({
      baseUrl: 'https://example.convex.site',
      apiKey: 'osk_secret123',
      fetchImpl,
    });
    await client.health();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0];
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer osk_secret123');
  });

  it('hits the correct path and strips trailing slashes from baseUrl', async () => {
    const fetchImpl = makeFetch({ status: 200, body: { data: { ok: true, version: '1.0' } } });
    const client = new OpenStaysClient({
      baseUrl: 'https://example.convex.site/',
      apiKey: 'osk_abc',
      fetchImpl,
    });
    await client.health();
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://example.convex.site/api/v1/health');
  });

  it('encodes query params for GET endpoints', async () => {
    const fetchImpl = makeFetch({ status: 200, body: { data: [] } });
    const client = new OpenStaysClient({
      baseUrl: 'https://example.convex.site',
      apiKey: 'osk_abc',
      fetchImpl,
    });
    await client.availability({
      property: 'pinewood flats',
      unitType: 'lakeview-cabin',
      from: '2026-07-01',
      to: '2026-07-10',
    });
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toContain('/api/v1/availability?');
    expect(url).toContain('property=pinewood+flats');
    expect(url).toContain('unitType=lakeview-cabin');
    expect(url).toContain('from=2026-07-01');
    expect(url).toContain('to=2026-07-10');
  });

  it('omits undefined query params', async () => {
    const fetchImpl = makeFetch({ status: 200, body: { data: [] } });
    const client = new OpenStaysClient({
      baseUrl: 'https://example.convex.site',
      apiKey: 'osk_abc',
      fetchImpl,
    });
    await client.listBookings({});
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://example.convex.site/api/v1/bookings');
  });

  it('sends a JSON body + Content-Type on POST', async () => {
    const fetchImpl = makeFetch({
      status: 200,
      body: { data: { bookingId: 'b1', confirmationCode: 'OS-ABC123', status: 'hold' } },
    });
    const client = new OpenStaysClient({
      baseUrl: 'https://example.convex.site',
      apiKey: 'osk_abc',
      fetchImpl,
    });
    await client.createHold({
      unitId: 'unit1',
      ratePlanId: 'plan1',
      checkIn: '2026-07-01',
      checkOut: '2026-07-03',
      adults: 2,
      children: 0,
      guest: { name: 'Sam Guest', email: 'sam@example.com', phone: '', marketingOptIn: false },
      addOns: [],
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://example.convex.site/api/v1/bookings/hold');
    expect(init!.method).toBe('POST');
    const headers = init!.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init!.body as string)).toMatchObject({ unitId: 'unit1', checkIn: '2026-07-01' });
  });

  it('throws a typed ApiError with status/code/message on the {error} envelope', async () => {
    const fetchImpl = makeFetch({
      status: 404,
      body: { error: { code: 'NOT_FOUND', message: 'Booking not found.' } },
    });
    const client = new OpenStaysClient({
      baseUrl: 'https://example.convex.site',
      apiKey: 'osk_abc',
      fetchImpl,
    });
    await expect(client.getBooking('OS-NOPE')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Booking not found.',
    });
    await expect(client.getBooking('OS-NOPE')).rejects.toBeInstanceOf(ApiError);
  });

  it('throws ApiError even when HTTP status is 200 but body carries {error}', async () => {
    const fetchImpl = makeFetch({
      status: 200,
      body: { error: { code: 'RATE_PLAN_INVALID', message: 'Rate plan does not match this unit.' } },
    });
    const client = new OpenStaysClient({
      baseUrl: 'https://example.convex.site',
      apiKey: 'osk_abc',
      fetchImpl,
    });
    await expect(
      client.createHold({
        unitId: 'u',
        ratePlanId: 'r',
        checkIn: '2026-07-01',
        checkOut: '2026-07-02',
        adults: 1,
        children: 0,
        guest: { name: 'A', email: 'a@example.com', phone: '', marketingOptIn: false },
        addOns: [],
      }),
    ).rejects.toMatchObject({ code: 'RATE_PLAN_INVALID' });
  });

  it('produces a fallback ApiError when the response body is not JSON', async () => {
    const fetchImpl = vi.fn(async () => {
      return {
        ok: false,
        status: 500,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      } as unknown as Response;
    });
    const client = new OpenStaysClient({
      baseUrl: 'https://example.convex.site',
      apiKey: 'osk_abc',
      fetchImpl,
    });
    await expect(client.health()).rejects.toMatchObject({ status: 500, code: 'INVALID_RESPONSE' });
  });

  it('cancelBooking posts email in the body and encodes the code in the path', async () => {
    const fetchImpl = makeFetch({ status: 200, body: { data: { refundCents: 500, paidCents: 1000 } } });
    const client = new OpenStaysClient({
      baseUrl: 'https://example.convex.site',
      apiKey: 'osk_abc',
      fetchImpl,
    });
    await client.cancelBooking('OS-AB 12', { email: 'guest@example.com' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://example.convex.site/api/v1/bookings/OS-AB%2012/cancel');
    expect(JSON.parse(init!.body as string)).toEqual({ email: 'guest@example.com' });
  });

  it('promoPreview posts to /promo-codes/preview', async () => {
    const fetchImpl = makeFetch({ status: 200, body: { data: { valid: false, reason: 'INVALID' } } });
    const client = new OpenStaysClient({
      baseUrl: 'https://example.convex.site',
      apiKey: 'osk_abc',
      fetchImpl,
    });
    const result = await client.promoPreview({ code: 'SUMMER10', property: 'pinewood', unitType: 'cabin' });
    expect(result).toEqual({ valid: false, reason: 'INVALID' });
    const [url] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://example.convex.site/api/v1/promo-codes/preview');
  });

  it('addresses bounded PMS views and audited operations actions', async () => {
    const fetchImpl = makeFetch({ status: 200, body: { data: { records: [] } } });
    const client = new OpenStaysClient({ baseUrl: 'https://example.convex.site', apiKey: 'osk_abc', fetchImpl });
    await client.operationsView({ property: 'kokanee', view: 'front-desk', date: '2030-08-10', limit: 25 });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://example.convex.site/api/v1/operations/front-desk?property=kokanee&date=2030-08-10&limit=25');
    await client.operationsAction('front-desk/transition', { property: 'kokanee', requestId: 'req-1', bookingId: 'b1', transition: 'check_in', expectedVersion: 0 });
    expect(fetchImpl.mock.calls[1][0]).toBe('https://example.convex.site/api/v1/operations/front-desk/transition');
  });

  it('listRatePlans returns the {unitTypeId, ratePlans} wire shape unchanged', async () => {
    const fetchImpl = makeFetch({
      status: 200,
      body: {
        data: {
          unitTypeId: 'ut1',
          ratePlans: [{ ratePlanId: 'rp1', name: 'Standard', currency: 'CAD', baseNightlyCents: 12000 }],
        },
      },
    });
    const client = new OpenStaysClient({
      baseUrl: 'https://example.convex.site',
      apiKey: 'osk_abc',
      fetchImpl,
    });
    const result = await client.listRatePlans({ property: 'pinewood-flats', unitType: 'cabin' });
    expect(result.unitTypeId).toBe('ut1');
    expect(result.ratePlans).toHaveLength(1);
    expect(result.ratePlans[0].name).toBe('Standard');
  });

  it('createHold returns the {bookingId, confirmationCode, price, holdExpiresAt} wire shape unchanged', async () => {
    const fetchImpl = makeFetch({
      status: 200,
      body: {
        data: {
          bookingId: 'b1',
          confirmationCode: 'OS-ABC123',
          holdExpiresAt: 1751328000000,
          price: {
            nightlySubtotalCents: 20000,
            addOnSubtotalCents: 0,
            promoDiscountCents: 0,
            taxableSubtotalCents: 20000,
            gstCents: 1000,
            totalCents: 21000,
            giftCertAppliedCents: 0,
            depositDueCents: 21000,
            balanceDueCents: 0,
          },
        },
      },
    });
    const client = new OpenStaysClient({
      baseUrl: 'https://example.convex.site',
      apiKey: 'osk_abc',
      fetchImpl,
    });
    const result = await client.createHold({
      unitId: 'unit1',
      ratePlanId: 'plan1',
      checkIn: '2026-07-01',
      checkOut: '2026-07-03',
      adults: 2,
      children: 0,
      guest: { name: 'Sam Guest', email: 'sam@example.com', phone: '', marketingOptIn: false },
      addOns: [],
    });
    expect(result.confirmationCode).toBe('OS-ABC123');
    expect(result.price.totalCents).toBe(21000);
    expect(result.holdExpiresAt).toBe(1751328000000);
  });
});
