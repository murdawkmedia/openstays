/// <reference types="vite/client" />
// Unit tests for the Channex REST client. Pure helpers are tested directly;
// the provider methods are exercised against a mocked global fetch (no network,
// no SDK). vi.stubEnv supplies the api key + base url.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  centsToDecimalString,
  channexBaseUrl,
  channexProvider,
  normalizeRevision,
} from './channex';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// centsToDecimalString — the cents → major-unit boundary conversion
// ---------------------------------------------------------------------------
describe('centsToDecimalString', () => {
  it('formats whole and fractional dollar amounts with 2 decimals', () => {
    expect(centsToDecimalString(12_900)).toBe('129.00');
    expect(centsToDecimalString(10_000)).toBe('100.00');
    expect(centsToDecimalString(5)).toBe('0.05');
    expect(centsToDecimalString(99)).toBe('0.99');
    expect(centsToDecimalString(0)).toBe('0.00');
    expect(centsToDecimalString(1)).toBe('0.01');
    expect(centsToDecimalString(123_456)).toBe('1234.56');
  });

  it('handles negative amounts (defensive — rates should never be negative)', () => {
    expect(centsToDecimalString(-100)).toBe('-1.00');
    expect(centsToDecimalString(-5)).toBe('-0.05');
  });

  it('truncates sub-cent noise rather than producing 3 decimals', () => {
    expect(centsToDecimalString(100.9 as number)).toBe('1.00');
  });
});

describe('channexBaseUrl', () => {
  it('defaults to staging when unset', () => {
    expect(channexBaseUrl()).toBe('https://staging.channex.io');
  });
  it('honors CHANNEX_BASE_URL override', () => {
    vi.stubEnv('CHANNEX_BASE_URL', 'https://channex.io');
    expect(channexBaseUrl()).toBe('https://channex.io');
  });
});

// ---------------------------------------------------------------------------
// pushAvailability — request body shape + warning parsing (200 ≠ all applied)
// ---------------------------------------------------------------------------
describe('channexProvider.pushAvailability', () => {
  it('builds { values } with property_id/room_type_id/date/availability and posts to /api/v1/availability', async () => {
    vi.stubEnv('CHANNEX_API_KEY', 'test-key');
    let capturedUrl = '';
    let capturedBody: unknown = null;
    let capturedHeaders: Record<string, string> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        capturedUrl = String(url);
        capturedBody = JSON.parse(String(init.body));
        capturedHeaders = init.headers as Record<string, string>;
        return new Response(JSON.stringify({ data: [], meta: { message: 'Success', warnings: [] } }), {
          status: 200,
        });
      }),
    );

    const result = await channexProvider.pushAvailability('prop-uuid', [
      { roomTypeId: 'rt-1', date: '2026-08-01', availability: 2 },
      { roomTypeId: 'rt-1', date: '2026-08-02', availability: 0 },
    ]);

    expect(result).toEqual({ ok: true, warnings: [] });
    expect(capturedUrl).toBe('https://staging.channex.io/api/v1/availability');
    expect(capturedHeaders['user-api-key']).toBe('test-key');
    expect(capturedBody).toEqual({
      values: [
        { property_id: 'prop-uuid', room_type_id: 'rt-1', date: '2026-08-01', availability: 2 },
        { property_id: 'prop-uuid', room_type_id: 'rt-1', date: '2026-08-02', availability: 0 },
      ],
    });
  });

  it('treats a 200 WITH meta.warnings as ok:false (200 does not mean every row applied)', async () => {
    vi.stubEnv('CHANNEX_API_KEY', 'test-key');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({ data: [], meta: { message: 'Success', warnings: ['row 2 invalid date'] } }),
          { status: 200 },
        ),
      ),
    );
    const result = await channexProvider.pushAvailability('prop-uuid', [
      { roomTypeId: 'rt-1', date: '2026-08-01', availability: 2 },
    ]);
    expect(result.ok).toBe(false);
    expect(result.warnings).toEqual(['row 2 invalid date']);
  });

  it('flags a 429 as retryable in the warning text', async () => {
    vi.stubEnv('CHANNEX_API_KEY', 'test-key');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"errors":{"code":"http_too_many_requests"}}', { status: 429 })),
    );
    const result = await channexProvider.pushAvailability('prop-uuid', [
      { roomTypeId: 'rt-1', date: '2026-08-01', availability: 2 },
    ]);
    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain('HTTP 429');
    expect(result.warnings[0]).toContain('retryable');
  });

  it('surfaces a non-2xx as ok:false with the body', async () => {
    vi.stubEnv('CHANNEX_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad request', { status: 400 })));
    const result = await channexProvider.pushAvailability('prop-uuid', [
      { roomTypeId: 'rt-1', date: '2026-08-01', availability: 2 },
    ]);
    expect(result.ok).toBe(false);
    expect(result.warnings[0]).toContain('HTTP 400');
    expect(result.warnings[0]).toContain('bad request');
  });

  it('short-circuits an empty batch without a network call', async () => {
    vi.stubEnv('CHANNEX_API_KEY', 'test-key');
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await channexProvider.pushAvailability('prop-uuid', []);
    expect(result).toEqual({ ok: true, warnings: [] });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// pushRestrictions — undefined keys omitted, decimal rate string passed through
// ---------------------------------------------------------------------------
describe('channexProvider.pushRestrictions', () => {
  it('omits undefined restriction keys and posts to /api/v1/restrictions', async () => {
    vi.stubEnv('CHANNEX_API_KEY', 'test-key');
    let capturedUrl = '';
    let capturedBody: { values: Array<Record<string, unknown>> } = { values: [] };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        capturedUrl = String(url);
        capturedBody = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ data: [], meta: { warnings: [] } }), { status: 200 });
      }),
    );

    const result = await channexProvider.pushRestrictions('prop-uuid', [
      { ratePlanId: 'rp-1', date: '2026-08-01', rate: '129.00', minStayArrival: 2 },
      { ratePlanId: 'rp-1', date: '2026-08-02', rate: '129.00' }, // no minStay
    ]);

    expect(result.ok).toBe(true);
    expect(capturedUrl).toBe('https://staging.channex.io/api/v1/restrictions');
    const [row0, row1] = capturedBody.values;
    expect(row0).toEqual({
      property_id: 'prop-uuid',
      rate_plan_id: 'rp-1',
      date: '2026-08-01',
      rate: '129.00',
      min_stay_arrival: 2,
    });
    // The second row must NOT carry a min_stay_arrival key at all.
    expect(row1).toEqual({
      property_id: 'prop-uuid',
      rate_plan_id: 'rp-1',
      date: '2026-08-02',
      rate: '129.00',
    });
    expect('min_stay_arrival' in row1).toBe(false);
  });

  it('passes closed_to_arrival / closed_to_departure / stop_sell booleans through when defined', async () => {
    vi.stubEnv('CHANNEX_API_KEY', 'test-key');
    let capturedBody: { values: Array<Record<string, unknown>> } = { values: [] };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        capturedBody = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ meta: { warnings: [] } }), { status: 200 });
      }),
    );
    await channexProvider.pushRestrictions('prop-uuid', [
      {
        ratePlanId: 'rp-1',
        date: '2026-08-01',
        closedToArrival: true,
        closedToDeparture: false,
        stopSell: true,
        maxStay: 14,
      },
    ]);
    expect(capturedBody.values[0]).toEqual({
      property_id: 'prop-uuid',
      rate_plan_id: 'rp-1',
      date: '2026-08-01',
      closed_to_arrival: true,
      closed_to_departure: false,
      stop_sell: true,
      max_stay: 14,
    });
  });
});

// ---------------------------------------------------------------------------
// normalizeRevision — flatten the raw feed shape into NormalizedRevision
// ---------------------------------------------------------------------------
describe('normalizeRevision', () => {
  const realisticRevision = {
    id: 'rev-abc',
    booking_id: 'bk-123',
    unique_id: 'unique-xyz',
    status: 'new',
    ota_name: 'Booking.com',
    ota_reservation_code: 'BDC-9988',
    arrival_date: '2026-09-10',
    departure_date: '2026-09-13',
    amount: '387.00',
    currency: 'CAD',
    customer: { name: 'Ada', surname: 'Lovelace', mail: 'ada@example.com', phone: '555-1234' },
    rooms: [
      {
        room_type_id: 'rt-77',
        rate_plan_id: 'rp-88',
        occupancy: { adults: 2, children: 1 },
        checkin_date: '2026-09-10',
        checkout_date: '2026-09-13',
      },
    ],
  };

  it('normalizes a realistic feed item', () => {
    const n = normalizeRevision(realisticRevision);
    expect(n).not.toBeNull();
    expect(n).toMatchObject({
      revisionId: 'rev-abc',
      bookingId: 'bk-123',
      status: 'new',
      otaName: 'Booking.com',
      otaReservationCode: 'BDC-9988',
      roomTypeId: 'rt-77',
      ratePlanId: 'rp-88',
      arrivalDate: '2026-09-10',
      departureDate: '2026-09-13',
      adults: 2,
      children: 1,
      guestName: 'Ada Lovelace',
      guestEmail: 'ada@example.com',
      guestPhone: '555-1234',
      currency: 'CAD',
    });
    // amount → cents via round(parseFloat * 100).
    expect(n?.amountCents).toBe(38_700);
  });

  it('maps modified/cancelled statuses and tolerates missing optional fields', () => {
    const cancelled = normalizeRevision({
      id: 'rev-2',
      booking_id: 'bk-123',
      status: 'cancelled',
      arrival_date: '2026-09-10',
      departure_date: '2026-09-13',
      rooms: [{ room_type_id: 'rt-77' }], // no rate plan, no occupancy, no customer
    });
    expect(cancelled?.status).toBe('cancelled');
    expect(cancelled?.ratePlanId).toBeUndefined();
    expect(cancelled?.adults).toBe(1); // default when occupancy missing
    expect(cancelled?.children).toBe(0);
    expect(cancelled?.guestName).toBe('OTA Guest'); // default when customer missing
    expect(cancelled?.otaName).toBe('OTA'); // default
  });

  it('returns null when required fields (ids, room type, dates) are missing', () => {
    expect(normalizeRevision(null)).toBeNull();
    expect(normalizeRevision({})).toBeNull();
    expect(
      normalizeRevision({ id: 'r', booking_id: 'b', arrival_date: '2026-09-10' }),
    ).toBeNull(); // no room type, no departure
    expect(
      normalizeRevision({ id: 'r', booking_id: 'b', rooms: [{ room_type_id: 'rt' }] }),
    ).toBeNull(); // no dates
  });

  it('flattens a JSON:API { id, attributes } item shape', () => {
    const n = normalizeRevision({
      id: 'rev-json-api',
      type: 'booking_revision',
      attributes: {
        booking_id: 'bk-9',
        status: 'modified',
        arrival_date: '2026-10-01',
        departure_date: '2026-10-05',
        ota_name: 'Airbnb',
        rooms: [{ room_type_id: 'rt-1', occupancy: { adults: 3 } }],
      },
    });
    expect(n?.revisionId).toBe('rev-json-api');
    expect(n?.bookingId).toBe('bk-9');
    expect(n?.status).toBe('modified');
    expect(n?.otaName).toBe('Airbnb');
    expect(n?.adults).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// fetchBookingRevisions — feed normalization + pagination
// ---------------------------------------------------------------------------
describe('channexProvider.fetchBookingRevisions', () => {
  it('normalizes a { data: [...] } feed page', async () => {
    vi.stubEnv('CHANNEX_API_KEY', 'test-key');
    let capturedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        capturedUrl = String(url);
        return new Response(
          JSON.stringify({
            data: [
              {
                id: 'rev-1',
                booking_id: 'bk-1',
                status: 'new',
                ota_name: 'Airbnb',
                arrival_date: '2026-08-01',
                departure_date: '2026-08-03',
                rooms: [{ room_type_id: 'rt-1', occupancy: { adults: 2, children: 0 } }],
                customer: { name: 'Grace', surname: 'Hopper' },
                amount: '200.00',
                currency: 'USD',
              },
            ],
            meta: { total_pages: 1 },
          }),
          { status: 200 },
        );
      }),
    );

    const revisions = await channexProvider.fetchBookingRevisions();
    expect(capturedUrl).toContain('/api/v1/booking_revisions/feed');
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      revisionId: 'rev-1',
      bookingId: 'bk-1',
      roomTypeId: 'rt-1',
      guestName: 'Grace Hopper',
      amountCents: 20_000,
    });
  });

  it('follows pagination when meta.total_pages > 1', async () => {
    vi.stubEnv('CHANNEX_API_KEY', 'test-key');
    const page = (id: string, totalPages: number) =>
      new Response(
        JSON.stringify({
          data: [
            {
              id,
              booking_id: `bk-${id}`,
              status: 'new',
              arrival_date: '2026-08-01',
              departure_date: '2026-08-02',
              rooms: [{ room_type_id: 'rt-1' }],
            },
          ],
          meta: { total_pages: totalPages },
        }),
        { status: 200 },
      );
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        return page(`rev-${call}`, 2);
      }),
    );
    const revisions = await channexProvider.fetchBookingRevisions();
    expect(revisions).toHaveLength(2);
    expect(revisions.map((r) => r.revisionId)).toEqual(['rev-1', 'rev-2']);
  });

  it('returns [] on a non-2xx feed response', async () => {
    vi.stubEnv('CHANNEX_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    expect(await channexProvider.fetchBookingRevisions()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ackBookingRevision — posts to the right URL, swallows errors
// ---------------------------------------------------------------------------
describe('channexProvider.ackBookingRevision', () => {
  it('POSTs to /api/v1/booking_revisions/:id/ack with the api key', async () => {
    vi.stubEnv('CHANNEX_API_KEY', 'test-key');
    let capturedUrl = '';
    let capturedMethod = '';
    let capturedHeaders: Record<string, string> = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        capturedUrl = String(url);
        capturedMethod = String(init.method);
        capturedHeaders = init.headers as Record<string, string>;
        return new Response('{}', { status: 200 });
      }),
    );
    await channexProvider.ackBookingRevision('rev-xyz');
    expect(capturedUrl).toBe('https://staging.channex.io/api/v1/booking_revisions/rev-xyz/ack');
    expect(capturedMethod).toBe('POST');
    expect(capturedHeaders['user-api-key']).toBe('test-key');
  });

  it('does not throw when the ack endpoint errors (revision re-appears next poll)', async () => {
    vi.stubEnv('CHANNEX_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('err', { status: 500 })));
    await expect(channexProvider.ackBookingRevision('rev-xyz')).resolves.toBeUndefined();
  });
});
