import { describe, expect, it, vi } from 'vitest';
import { CliUsageError, dispatch, HELP_TEXT, parseArgs, VERSION } from './index.js';
import { ApiError, OpenStaysClient } from './client.js';

function fakeClient(overrides: Partial<OpenStaysClient> = {}): OpenStaysClient {
  // We only need the methods dispatch() actually calls; cast through unknown
  // to avoid re-implementing the whole class for each test.
  return overrides as OpenStaysClient;
}

describe('parseArgs', () => {
  it('parses a bare command with no flags', () => {
    const parsed = parseArgs(['health']);
    expect(parsed.command).toBe('health');
    expect(parsed.flags).toEqual({});
    expect(parsed.json).toBe(false);
  });

  it('parses --flag value pairs', () => {
    const parsed = parseArgs(['unit-types', '--property', 'pinewood-flats']);
    expect(parsed.command).toBe('unit-types');
    expect(parsed.flags.property).toBe('pinewood-flats');
  });

  it('parses --json as a boolean switch anywhere in argv', () => {
    const parsed = parseArgs(['properties', '--json']);
    expect(parsed.json).toBe(true);
    expect(parsed.command).toBe('properties');
  });

  it('parses positional args (e.g. booking code) alongside flags', () => {
    const parsed = parseArgs(['booking', 'OS-7K3M2Q', '--json']);
    expect(parsed.command).toBe('booking');
    expect(parsed.positional).toEqual(['OS-7K3M2Q']);
    expect(parsed.json).toBe(true);
  });

  it('parses cancel <code> --email <e>', () => {
    const parsed = parseArgs(['cancel', 'OS-ABC123', '--email', 'guest@example.com']);
    expect(parsed.positional).toEqual(['OS-ABC123']);
    expect(parsed.flags.email).toBe('guest@example.com');
  });

  it('parses --url and --key overrides', () => {
    const parsed = parseArgs(['health', '--url', 'https://x.convex.site', '--key', 'osk_abc']);
    expect(parsed.url).toBe('https://x.convex.site');
    expect(parsed.key).toBe('osk_abc');
  });

  it('parses -h/--help and -v/--version', () => {
    expect(parseArgs(['-h']).help).toBe(true);
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-v']).version).toBe(true);
    expect(parseArgs(['--version']).version).toBe(true);
  });

  it('treats an unrecognized token before a known command as positional, not a flag value bug', () => {
    const parsed = parseArgs(['bookings', '--status', 'confirmed', '--limit', '5']);
    expect(parsed.flags.status).toBe('confirmed');
    expect(parsed.flags.limit).toBe('5');
  });

  it('treats a trailing boolean flag (no following value) as "true"', () => {
    const parsed = parseArgs(['hold', '--marketing-opt-in']);
    expect(parsed.flags['marketing-opt-in']).toBe('true');
  });
});

describe('dispatch', () => {
  it('dispatches health and formats a human summary', async () => {
    const client = fakeClient({ health: vi.fn().mockResolvedValue({ ok: true, version: '1.2.3' }) });
    const parsed = parseArgs(['health']);
    const out = await dispatch(parsed, client);
    expect(out).toBe('ok=true version=1.2.3');
  });

  it('dispatches health with --json and prints raw JSON', async () => {
    const client = fakeClient({ health: vi.fn().mockResolvedValue({ ok: true, version: '1.2.3' }) });
    const parsed = parseArgs(['health', '--json']);
    const out = await dispatch(parsed, client);
    expect(JSON.parse(out)).toEqual({ ok: true, version: '1.2.3' });
  });

  it('dispatches properties to client.listProperties', async () => {
    const listProperties = vi.fn().mockResolvedValue([
      { propertyId: 'p1', name: 'Pinewood Flats', slug: 'pinewood-flats', active: true, currency: 'CAD', taxLabel: 'GST' },
    ]);
    const client = fakeClient({ listProperties });
    const parsed = parseArgs(['properties']);
    const out = await dispatch(parsed, client);
    expect(listProperties).toHaveBeenCalledTimes(1);
    expect(out).toContain('pinewood-flats');
  });

  it('dispatches unit-types and passes --property through', async () => {
    const listUnitTypes = vi.fn().mockResolvedValue([]);
    const client = fakeClient({ listUnitTypes });
    const parsed = parseArgs(['unit-types', '--property', 'pinewood-flats']);
    await dispatch(parsed, client);
    expect(listUnitTypes).toHaveBeenCalledWith({ property: 'pinewood-flats' });
  });

  it('unit-types throws CliUsageError when --property is missing', async () => {
    const client = fakeClient({ listUnitTypes: vi.fn() });
    const parsed = parseArgs(['unit-types']);
    await expect(dispatch(parsed, client)).rejects.toBeInstanceOf(CliUsageError);
  });

  it('dispatches availability with all required flags', async () => {
    const availability = vi.fn().mockResolvedValue({ units: [], startDate: '2026-07-01', endDate: '2026-07-10' });
    const client = fakeClient({ availability });
    const parsed = parseArgs([
      'availability',
      '--property', 'pinewood-flats',
      '--unit-type', 'lakeview-cabin',
      '--from', '2026-07-01',
      '--to', '2026-07-10',
    ]);
    await dispatch(parsed, client);
    expect(availability).toHaveBeenCalledWith({
      property: 'pinewood-flats',
      unitType: 'lakeview-cabin',
      from: '2026-07-01',
      to: '2026-07-10',
    });
  });

  it('dispatches bookings with optional filters and a numeric limit', async () => {
    const listBookings = vi.fn().mockResolvedValue([]);
    const client = fakeClient({ listBookings });
    const parsed = parseArgs(['bookings', '--status', 'confirmed', '--limit', '5']);
    await dispatch(parsed, client);
    expect(listBookings).toHaveBeenCalledWith({
      status: 'confirmed',
      from: undefined,
      to: undefined,
      limit: 5,
    });
  });

  it('dispatches booking <code> and requires the positional arg', async () => {
    const client = fakeClient({ getBooking: vi.fn() });
    const parsed = parseArgs(['booking']);
    await expect(dispatch(parsed, client)).rejects.toBeInstanceOf(CliUsageError);
  });

  it('dispatches booking <code> to client.getBooking and renders a summary', async () => {
    const getBooking = vi.fn().mockResolvedValue({
      currency: 'CAD',
      status: 'confirmed',
      confirmationCode: 'OS-7K3M2Q',
      checkIn: '2026-07-01',
      checkOut: '2026-07-03',
      nights: 2,
      adults: 2,
      children: 0,
      unitName: 'Cabin 1',
      unitTypeName: 'Lakeview Cabin',
      addOns: [],
      priceBreakdown: {
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
    });
    const client = fakeClient({ getBooking });
    const parsed = parseArgs(['booking', 'OS-7K3M2Q']);
    const out = await dispatch(parsed, client);
    expect(getBooking).toHaveBeenCalledWith('OS-7K3M2Q');
    expect(out).toContain('OS-7K3M2Q');
    expect(out).toContain('210.00 CAD');
  });

  it('dispatches hold with required guest fields mapped correctly', async () => {
    const createHold = vi.fn().mockResolvedValue({
      bookingId: 'b1',
      confirmationCode: 'OS-NEW111',
      holdExpiresAt: Date.parse('2026-07-01T12:00:00.000Z'),
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
    });
    const client = fakeClient({ createHold });
    const parsed = parseArgs([
      'hold',
      '--unit-id', 'unit1',
      '--rate-plan-id', 'plan1',
      '--check-in', '2026-07-01',
      '--check-out', '2026-07-03',
      '--adults', '2',
      '--children', '1',
      '--name', 'Sam Guest',
      '--email', 'sam@example.com',
      '--phone', '780-555-0100',
    ]);
    const out = await dispatch(parsed, client);
    expect(createHold).toHaveBeenCalledWith({
      unitId: 'unit1',
      ratePlanId: 'plan1',
      checkIn: '2026-07-01',
      checkOut: '2026-07-03',
      adults: 2,
      children: 1,
      guest: { name: 'Sam Guest', email: 'sam@example.com', phone: '780-555-0100', marketingOptIn: false },
      addOns: [],
      promoCode: undefined,
    });
    expect(out).toContain('OS-NEW111');
    expect(out).toContain('210.00');
  });

  it('hold throws CliUsageError when a required flag is missing', async () => {
    const client = fakeClient({ createHold: vi.fn() });
    const parsed = parseArgs(['hold', '--unit-id', 'unit1']);
    await expect(dispatch(parsed, client)).rejects.toBeInstanceOf(CliUsageError);
  });

  it('hold rejects a non-numeric --adults locally, before any API call', async () => {
    const createHold = vi.fn();
    const client = fakeClient({ createHold });
    const parsed = parseArgs([
      'hold',
      '--unit-id', 'unit1',
      '--rate-plan-id', 'plan1',
      '--check-in', '2026-07-01',
      '--check-out', '2026-07-03',
      '--adults', 'abc',
      '--name', 'Sam Guest',
      '--email', 'sam@example.com',
    ]);
    await expect(dispatch(parsed, client)).rejects.toThrow(/--adults must be a positive integer/);
    // The failure is caught client-side — the API is never called.
    expect(createHold).not.toHaveBeenCalled();
  });

  it('hold rejects a non-numeric --children locally', async () => {
    const createHold = vi.fn();
    const client = fakeClient({ createHold });
    const parsed = parseArgs([
      'hold',
      '--unit-id', 'unit1',
      '--rate-plan-id', 'plan1',
      '--check-in', '2026-07-01',
      '--check-out', '2026-07-03',
      '--adults', '2',
      '--children', 'oops',
      '--name', 'Sam Guest',
      '--email', 'sam@example.com',
    ]);
    await expect(dispatch(parsed, client)).rejects.toThrow(/--children must be a non-negative integer/);
    expect(createHold).not.toHaveBeenCalled();
  });

  it('dispatches cancel <code> --email <e>', async () => {
    const cancelBooking = vi.fn().mockResolvedValue({ refundCents: 5000, paidCents: 10000 });
    const client = fakeClient({ cancelBooking });
    const parsed = parseArgs(['cancel', 'OS-ABC123', '--email', 'guest@example.com']);
    const out = await dispatch(parsed, client);
    expect(cancelBooking).toHaveBeenCalledWith('OS-ABC123', { email: 'guest@example.com' });
    expect(out).toContain('50.00');
  });

  it('dispatches promo-preview', async () => {
    const promoPreview = vi.fn().mockResolvedValue({ valid: true, code: 'SUMMER10', kind: 'percent' });
    const client = fakeClient({ promoPreview });
    const parsed = parseArgs(['promo-preview', '--code', 'SUMMER10', '--property', 'pinewood', '--unit-type', 'cabin']);
    const out = await dispatch(parsed, client);
    expect(promoPreview).toHaveBeenCalledWith({ code: 'SUMMER10', property: 'pinewood', unitType: 'cabin' });
    expect(out).toContain('valid: SUMMER10');
  });

  it('dispatches generic PMS views and audited actions', async () => {
    const operationsView = vi.fn().mockResolvedValue({ records: [] });
    const operationsAction = vi.fn().mockResolvedValue({ replayed: false });
    const client = fakeClient({ operationsView, operationsAction });
    const viewOutput = await dispatch(parseArgs(['ops', 'housekeeping', '--property', 'kokanee', '--date', '2030-08-10']), client);
    expect(JSON.parse(viewOutput)).toEqual({ records: [] });
    expect(operationsView).toHaveBeenCalledWith({ property: 'kokanee', view: 'housekeeping', date: '2030-08-10', query: undefined, from: undefined, to: undefined, limit: undefined });
    await dispatch(parseArgs(['ops-action', 'housekeeping/state', '--property', 'kokanee', '--request-id', 'req-hk', '--input-json', '{"unitId":"u1","state":"dirty","expectedVersion":0}']), client);
    expect(operationsAction).toHaveBeenCalledWith('housekeeping/state', { property: 'kokanee', requestId: 'req-hk', unitId: 'u1', state: 'dirty', expectedVersion: 0 });
  });

  it('propagates ApiError from the client unchanged', async () => {
    const client = fakeClient({
      getBooking: vi.fn().mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Booking not found.')),
    });
    const parsed = parseArgs(['booking', 'OS-NOPE']);
    await expect(dispatch(parsed, client)).rejects.toBeInstanceOf(ApiError);
  });

  it('throws CliUsageError for an unknown command', async () => {
    const client = fakeClient();
    const parsed = parseArgs(['frobnicate']);
    await expect(dispatch(parsed, client)).rejects.toBeInstanceOf(CliUsageError);
  });
});

describe('HELP_TEXT', () => {
  it('documents the hold command with --unit-id / --rate-plan-id, not --property/--unit-type', () => {
    // The hold dispatch requires --unit-id and --rate-plan-id; the help must
    // match the actual contract (and the README), not advertise flags the
    // command ignores.
    const holdLine = HELP_TEXT.slice(HELP_TEXT.indexOf('  hold '));
    expect(holdLine).toContain('--unit-id');
    expect(holdLine).toContain('--rate-plan-id');
    // The old, wrong flags must be gone from the hold usage.
    const holdBlock = holdLine.slice(0, holdLine.indexOf('cancel'));
    expect(holdBlock).not.toContain('--property');
    expect(holdBlock).not.toContain('--unit-type');
  });
});

describe('VERSION', () => {
  it('is a non-empty semver-ish string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});
