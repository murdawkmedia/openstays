/// <reference types="vite/client" />
// Tests for the OTA booking-revision ingest. ingestRevision is driven directly
// as a mutation (deterministic); one end-to-end test exercises
// syncBookingRevisions ack-ordering against a mocked Channex feed.
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import schema from '../schema';
import { addDays, todayInTimezone } from '../../shared/pricing';

// Absolute-from-project-root glob: from a nested test dir, a `../**` relative
// glob does NOT re-capture sibling channel modules in Vite, so convex-test
// can't resolve `channel/*`. Rooting at `/convex/**` captures every module
// (incl. _generated), which is what convex-test needs.
const modules = import.meta.glob('/convex/**/!(*.*.*)*.*s');

const created: Array<ReturnType<typeof convexTest>> = [];
function makeT() {
  const t = convexTest(schema, modules);
  created.push(t);
  return t;
}
// `ReturnType<typeof makeT>` carries the schema types so `.withIndex` resolves
// the real (non-system) indexes; a bare `ReturnType<typeof convexTest>` would
// fall back to SystemIndexes and reject 'by_channelBooking'.
type T = ReturnType<typeof makeT>;
async function drainAll() {
  for (const t of created) {
    for (let i = 0; i < 50; i += 1) {
      const pending = await t.run(async (ctx) => {
        const jobs = await ctx.db.system.query('_scheduled_functions').collect();
        return jobs.filter((j) => j.state.kind === 'pending' || j.state.kind === 'inProgress').length;
      });
      if (pending === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
      await t.finishInProgressScheduledFunctions();
    }
  }
  created.length = 0;
}

afterEach(async () => {
  await drainAll();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const TZ = 'America/Edmonton';
const todayIso = todayInTimezone(TZ);
const D = (offset: number) => addDays(todayIso, offset);

/** Seed a property with a mapped Cabin type (channexRoomTypeId) + N units. */
async function seed(t: T, unitCount = 2) {
  return await t.run(async (ctx) => {
    const propertyId = await ctx.db.insert('properties', {
      name: 'Test Grounds',
      slug: 'test-grounds',
      timezone: TZ,
      currency: 'CAD',
      taxRateBps: 500,
      email: 'ops@example.com',
      phone: '555',
      address: '1 Test Rd',
      checkInTime: '16:00',
      checkOutTime: '11:00',
      active: true,
      channexPropertyId: 'chx-prop-1',
    });
    const unitTypeId = await ctx.db.insert('unitTypes', {
      propertyId,
      name: 'Cabin',
      slug: 'cabin',
      kind: 'cabin',
      bookingMode: 'nightly',
      description: '',
      photoUrls: [],
      maxOccupancy: 4,
      amenities: [],
      comingSoon: false,
      sortOrder: 1,
      channexRoomTypeId: 'chx-rt-cabin',
    });
    const unitIds: Id<'units'>[] = [];
    for (let i = 1; i <= unitCount; i += 1) {
      unitIds.push(
        await ctx.db.insert('units', {
          propertyId,
          unitTypeId,
          name: `Cabin ${i}`,
          slug: `cabin-${i}`,
          status: 'active',
          icalExportToken: `tok-cabin-${i}-${'x'.repeat(12)}`,
          icalImports: [],
          sortOrder: i,
        }),
      );
    }
    // channelSync row so ARI-push scheduling + poll-stamp have a target.
    await ctx.db.insert('channelSync', {
      propertyId,
      provider: 'channex',
      enabled: true,
    });
    return { propertyId, unitTypeId, unitIds };
  });
}

/** Base ingestRevision args for a NEW Booking.com reservation. */
function newRev(overrides: Record<string, unknown> = {}) {
  return {
    revisionId: 'rev-1',
    bookingId: 'bk-1',
    status: 'new' as const,
    otaName: 'Booking.com',
    otaReservationCode: 'BDC-1',
    roomTypeId: 'chx-rt-cabin',
    ratePlanId: 'chx-rp-standard',
    arrivalDate: D(5),
    departureDate: D(8),
    adults: 2,
    children: 0,
    guestName: 'Ada Lovelace',
    guestEmail: 'ada@example.com',
    guestPhone: '555-0001',
    amountCents: 30_000,
    currency: 'CAD',
    ...overrides,
  };
}

async function bookingsFor(t: T, channelBookingId: string) {
  return await t.run(async (ctx) =>
    ctx.db
      .query('bookings')
      .withIndex('by_channelBooking', (q) => q.eq('channelBookingId', channelBookingId))
      .collect(),
  );
}
async function nightsFor(t: T, bookingId: Id<'bookings'>) {
  return await t.run(async (ctx) =>
    ctx.db
      .query('unitNights')
      .withIndex('by_booking', (q) => q.eq('bookingId', bookingId))
      .collect(),
  );
}

describe('ingestRevision — new booking', () => {
  it('creates an external booking + nights and decrements availability', async () => {
    const t = makeT();
    await seed(t);
    const result = await t.mutation(internal.channel.ingest.ingestRevision, newRev());
    expect(result.outcome).toBe('created');

    const bookings = await bookingsFor(t, 'bk-1');
    expect(bookings).toHaveLength(1);
    const booking = bookings[0];
    expect(booking.status).toBe('external');
    expect(booking.source).toBe('channel:Booking.com');
    expect(booking.channelBookingId).toBe('bk-1');
    expect(booking.syncConflict).toBeUndefined();
    expect(booking.guestId).toBeUndefined();
    expect(booking.checkIn).toBe(D(5));
    expect(booking.checkOut).toBe(D(8));
    // Guest identity preserved in notes (no guest account for OTA bookings).
    expect(booking.notes[0].text).toContain('Ada Lovelace');
    expect(booking.notes[0].text).toContain('ada@example.com');

    const nights = await nightsFor(t, booking._id);
    expect(nights.map((n) => n.date).sort()).toEqual([D(5), D(6), D(7)]);
    expect(nights.every((n) => n.kind === 'external')).toBe(true);

    // Availability now reflects the decrement: 2 units, one booked D(5)..D(8).
    const ari = await t.query(internal.channel.ari.computeAriForProperty, {
      propertyId: booking.propertyId,
      horizonDays: 10,
    });
    const byDate = new Map(
      ari!.availability.filter((r) => r.roomTypeId === 'chx-rt-cabin').map((r) => [r.date, r.availability]),
    );
    expect(byDate.get(D(5))).toBe(1);
    expect(byDate.get(D(4))).toBe(2);
  });

  it('is idempotent: a duplicate revisionId does not double-book', async () => {
    const t = makeT();
    await seed(t);
    const first = await t.mutation(internal.channel.ingest.ingestRevision, newRev());
    expect(first.outcome).toBe('created');
    const second = await t.mutation(internal.channel.ingest.ingestRevision, newRev());
    expect(second.outcome).toBe('duplicate');

    const bookings = await bookingsFor(t, 'bk-1');
    expect(bookings).toHaveLength(1); // NOT two
  });
});

describe('ingestRevision — modification & cancellation', () => {
  it('modified rewrites dates + nights (same booking id, new revision id)', async () => {
    const t = makeT();
    await seed(t);
    await t.mutation(internal.channel.ingest.ingestRevision, newRev());

    const mod = await t.mutation(
      internal.channel.ingest.ingestRevision,
      newRev({ revisionId: 'rev-2', status: 'modified', arrivalDate: D(5), departureDate: D(7) }),
    );
    expect(mod.outcome).toBe('modified');

    const bookings = await bookingsFor(t, 'bk-1');
    expect(bookings).toHaveLength(1); // still one booking
    const booking = bookings[0];
    expect(booking.checkOut).toBe(D(7)); // shortened
    const nights = await nightsFor(t, booking._id);
    expect(nights.map((n) => n.date).sort()).toEqual([D(5), D(6)]); // D(7) freed
  });

  it('cancelled frees the nights and marks the booking cancelled', async () => {
    const t = makeT();
    await seed(t);
    await t.mutation(internal.channel.ingest.ingestRevision, newRev());

    const cancel = await t.mutation(
      internal.channel.ingest.ingestRevision,
      newRev({ revisionId: 'rev-3', status: 'cancelled' }),
    );
    expect(cancel.outcome).toBe('cancelled');

    const bookings = await bookingsFor(t, 'bk-1');
    expect(bookings[0].status).toBe('cancelled');
    const nights = await nightsFor(t, bookings[0]._id);
    expect(nights).toHaveLength(0); // freed

    // Availability restored to 2 everywhere.
    const ari = await t.query(internal.channel.ari.computeAriForProperty, {
      propertyId: bookings[0].propertyId,
      horizonDays: 10,
    });
    const byDate = new Map(
      ari!.availability.filter((r) => r.roomTypeId === 'chx-rt-cabin').map((r) => [r.date, r.availability]),
    );
    expect(byDate.get(D(5))).toBe(2);
  });
});

describe('ingestRevision — unmapped room type', () => {
  it('returns unmapped without throwing, creates no booking, and does NOT burn idempotency', async () => {
    const t = makeT();
    await seed(t);
    const result = await t.mutation(
      internal.channel.ingest.ingestRevision,
      newRev({ roomTypeId: 'chx-rt-UNKNOWN' }),
    );
    expect(result.outcome).toBe('unmapped');
    // The unmapped room type id is surfaced so the action can alert on it.
    expect(result.roomTypeId).toBe('chx-rt-UNKNOWN');
    const bookings = await bookingsFor(t, 'bk-1');
    expect(bookings).toHaveLength(0);

    // CRITICAL (adversarial-review fix): an unmapped revision must NOT record a
    // webhookEvents idempotency row, so re-delivery re-attempts the mapping
    // instead of short-circuiting to 'duplicate'. Otherwise, once the operator
    // maps the room type, the already-arrived (acked) sale would be permanently
    // lost. A re-delivery while still unmapped therefore returns 'unmapped'
    // again (never 'duplicate').
    const retry = await t.mutation(
      internal.channel.ingest.ingestRevision,
      newRev({ roomTypeId: 'chx-rt-UNKNOWN' }),
    );
    expect(retry.outcome).toBe('unmapped');
    // No idempotency ledger row was written for the real revision id.
    const ledger = await t.run(async (ctx) =>
      ctx.db
        .query('webhookEvents')
        .withIndex('by_provider_event', (q) => q.eq('provider', 'channex').eq('eventId', 'rev-1'))
        .collect(),
    );
    expect(ledger).toHaveLength(0);
  });

  it('re-ingests and creates the booking once the room type is later mapped', async () => {
    const t = makeT();
    const fx = await seed(t);

    // Poll while unmapped → no booking, un-acked (returns 'unmapped').
    const first = await t.mutation(
      internal.channel.ingest.ingestRevision,
      newRev({ roomTypeId: 'chx-rt-LATER' }),
    );
    expect(first.outcome).toBe('unmapped');
    expect(await bookingsFor(t, 'bk-1')).toHaveLength(0);

    // Operator maps the room type to the seeded Cabin unit type.
    await t.run(async (ctx) => {
      await ctx.db.patch(fx.unitTypeId, { channexRoomTypeId: 'chx-rt-LATER' });
    });

    // Re-delivery now ingests the sale (no idempotency row blocked it).
    const second = await t.mutation(
      internal.channel.ingest.ingestRevision,
      newRev({ roomTypeId: 'chx-rt-LATER' }),
    );
    expect(second.outcome).toBe('created');
    const bookings = await bookingsFor(t, 'bk-1');
    expect(bookings).toHaveLength(1);
    expect(bookings[0].status).toBe('external');
  });

  it('syncBookingRevisions does NOT ack an unmapped revision and schedules a one-time staff alert', async () => {
    vi.stubEnv('CHANNEX_API_KEY', 'test-key');
    vi.stubEnv('DEMO_MODE', 'true'); // sendStaffAlert degrades to an emailLog row
    const t = makeT();
    await seed(t);

    const acked: string[] = [];
    const feedItem = {
      id: 'rev-unmapped-1',
      booking_id: 'bk-unmapped-1',
      status: 'new',
      ota_name: 'Airbnb',
      arrival_date: D(10),
      departure_date: D(12),
      amount: '250.00',
      currency: 'CAD',
      customer: { name: 'Grace', surname: 'Hopper' },
      rooms: [{ room_type_id: 'chx-rt-NOT-MAPPED', occupancy: { adults: 2, children: 0 } }],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.includes('/booking_revisions/feed')) {
          return new Response(JSON.stringify({ data: [feedItem], meta: { total_pages: 1 } }), {
            status: 200,
          });
        }
        if (u.includes('/ack') && init?.method === 'POST') {
          const m = u.match(/booking_revisions\/([^/]+)\/ack/);
          if (m) acked.push(decodeURIComponent(m[1]));
          return new Response('{}', { status: 200 });
        }
        return new Response(JSON.stringify({ meta: { warnings: [] } }), { status: 200 });
      }),
    );

    await t.action(internal.channel.ingest.syncBookingRevisions, {});

    // Un-acked — the sale stays in the feed until the room type is mapped.
    expect(acked).toHaveLength(0);
    // No booking created (unmapped).
    expect(await bookingsFor(t, 'bk-unmapped-1')).toHaveLength(0);

    await drainAll();

    // A one-time staff alert was scheduled (emailLog row in DEMO).
    const alerts = await t.run(async (ctx) =>
      ctx.db.query('emailLog').filter((q) => q.eq(q.field('templateKey'), 'staff_alert')).collect(),
    );
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    expect(alerts.some((a) => a.subject.includes('chx-rt-NOT-MAPPED'))).toBe(true);

    // A syncLog row records the unmapped booking for the Channels page.
    const logs = await t.run(async (ctx) => ctx.db.query('channelSyncLog').collect());
    expect(logs.some((l) => l.detail.includes('UNMAPPED') && l.detail.includes('chx-rt-NOT-MAPPED'))).toBe(true);

    // The alert is ONE-TIME: a second poll of the same still-unmapped revision
    // does not schedule another alert (guarded by the unmapped-alert marker).
    const alertsBefore = alerts.length;
    await t.action(internal.channel.ingest.syncBookingRevisions, {});
    await drainAll();
    const alertsAfter = await t.run(async (ctx) =>
      ctx.db.query('emailLog').filter((q) => q.eq(q.field('templateKey'), 'staff_alert')).collect(),
    );
    expect(alertsAfter.length).toBe(alertsBefore);
  });
});

describe('ingestRevision — OVERSELL (all units occupied)', () => {
  it('still creates the booking, flags syncConflict, alerts staff, and never clobbers internal bookings', async () => {
    vi.stubEnv('DEMO_MODE', 'true'); // sendStaffAlert degrades to an emailLog row
    const t = makeT();
    const fx = await seed(t, 1); // ONE unit → easy to fully occupy

    // An INTERNAL booking fills the only unit for the overlap window.
    const internalBookingId = await t.run(async (ctx) => {
      const now = Date.now();
      const id = await ctx.db.insert('bookings', {
        propertyId: fx.propertyId,
        unitId: fx.unitIds[0],
        unitTypeId: fx.unitTypeId,
        status: 'confirmed',
        checkIn: D(5),
        checkOut: D(8),
        nights: 3,
        adults: 2,
        children: 0,
        source: 'front_desk',
        confirmationCode: 'OS-INTERNAL',
        statusHistory: [{ status: 'confirmed', ts: now }],
        notes: [],
        createdAt: now,
        updatedAt: now,
      });
      for (let d = D(5); d < D(8); d = addDays(d, 1)) {
        await ctx.db.insert('unitNights', { unitId: fx.unitIds[0], date: d, bookingId: id, kind: 'stay' });
      }
      return id;
    });

    // An OTA sells the same unit-type for overlapping nights → real oversell.
    const result = await t.mutation(internal.channel.ingest.ingestRevision, newRev());
    expect(result.outcome).toBe('oversell');

    // The OTA booking WAS created (never dropped) + flagged.
    const otaBookings = await bookingsFor(t, 'bk-1');
    expect(otaBookings).toHaveLength(1);
    const ota = otaBookings[0];
    expect(ota.status).toBe('external');
    expect(ota.syncConflict).toBe(true);
    // It has NO unitNights (so it can't clobber the internal booking's nights).
    const otaNights = await nightsFor(t, ota._id);
    expect(otaNights).toHaveLength(0);

    // The internal booking is UNTOUCHED — its nights are intact.
    const internalNights = await nightsFor(t, internalBookingId);
    expect(internalNights.map((n) => n.date).sort()).toEqual([D(5), D(6), D(7)]);
    const internalBooking = await t.run(async (ctx) => ctx.db.get(internalBookingId));
    expect(internalBooking?.status).toBe('confirmed');

    // An OVERSELL syncLog row was written ok:false.
    const logs = await t.run(async (ctx) =>
      ctx.db
        .query('channelSyncLog')
        .withIndex('by_property_ts', (q) => q.eq('propertyId', fx.propertyId))
        .collect(),
    );
    const oversellLog = logs.find((l) => l.detail.includes('OVERSELL'));
    expect(oversellLog).toBeDefined();
    expect(oversellLog?.ok).toBe(false);

    // A staff alert was scheduled → after draining, an emailLog 'staff_alert' row.
    await drainAll();
    const alerts = await t.run(async (ctx) =>
      ctx.db.query('emailLog').filter((q) => q.eq(q.field('templateKey'), 'staff_alert')).collect(),
    );
    expect(alerts.length).toBeGreaterThanOrEqual(1);
  });
});

describe('syncBookingRevisions — ack ordering (ack only AFTER durable write)', () => {
  it('fetches the feed, ingests, then acks each revision', async () => {
    vi.stubEnv('CHANNEX_API_KEY', 'test-key');
    vi.stubEnv('DEMO_MODE', 'true');
    const t = makeT();
    await seed(t);

    const acked: string[] = [];
    const feedItem = {
      id: 'rev-feed-1',
      booking_id: 'bk-feed-1',
      status: 'new',
      ota_name: 'Airbnb',
      arrival_date: D(10),
      departure_date: D(12),
      amount: '250.00',
      currency: 'CAD',
      customer: { name: 'Grace', surname: 'Hopper' },
      rooms: [{ room_type_id: 'chx-rt-cabin', occupancy: { adults: 2, children: 0 } }],
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        if (u.includes('/booking_revisions/feed')) {
          return new Response(JSON.stringify({ data: [feedItem], meta: { total_pages: 1 } }), {
            status: 200,
          });
        }
        if (u.includes('/ack') && init?.method === 'POST') {
          const m = u.match(/booking_revisions\/([^/]+)\/ack/);
          if (m) acked.push(decodeURIComponent(m[1]));
          return new Response('{}', { status: 200 });
        }
        // ARI push endpoints (scheduled after ingest) — succeed silently.
        return new Response(JSON.stringify({ meta: { warnings: [] } }), { status: 200 });
      }),
    );

    await t.action(internal.channel.ingest.syncBookingRevisions, {});

    // The booking was durably written…
    const bookings = await bookingsFor(t, 'bk-feed-1');
    expect(bookings).toHaveLength(1);
    expect(bookings[0].status).toBe('external');
    // …and only then acked.
    expect(acked).toEqual(['rev-feed-1']);

    await drainAll();
  });

  it('does not ack when the feed fetch is impossible (configured but provider errors) — nothing lost', async () => {
    vi.stubEnv('CHANNEX_API_KEY', 'test-key');
    const t = makeT();
    await seed(t);
    const acked: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const u = String(url);
        if (u.includes('/ack')) {
          acked.push(u);
          return new Response('{}', { status: 200 });
        }
        // Feed returns 500 → fetchBookingRevisions yields [] → no ingest, no ack.
        return new Response('err', { status: 500 });
      }),
    );
    await t.action(internal.channel.ingest.syncBookingRevisions, {});
    expect(acked).toHaveLength(0);
    await drainAll();
  });
});

describe('handleWebhookNudge', () => {
  it('rejects a wrong shared secret without scheduling a poll OR writing a log row (still 200)', async () => {
    vi.stubEnv('CHANNEX_API_KEY', 'test-key');
    vi.stubEnv('CHANNEX_WEBHOOK_SECRET', 'sekret');
    const t = makeT();
    await seed(t);
    const res = await t.action(internal.channel.ingest.handleWebhookNudge, {
      headers: { 'x-channex-webhook-secret': 'WRONG' },
    });
    expect(res.status).toBe(200);
    // No syncBookingRevisions scheduled (fail closed).
    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    );
    const polls = scheduled.filter((j) => JSON.stringify(j.name ?? '').includes('syncBookingRevisions'));
    expect(polls).toHaveLength(0);
    // And NO channelSyncLog row (adversarial-review fix): rejected-nudge logging
    // was itself an unauthenticated unbounded-write amplifier — it is now dropped.
    const logs = await t.run(async (ctx) => ctx.db.query('channelSyncLog').collect());
    expect(logs).toHaveLength(0);
    await drainAll();
  });

  it('with NO secret configured, does NOT schedule a poll and writes no rows (fail closed)', async () => {
    // CHANNEX_API_KEY may be set (live deployment) but the OPTIONAL secret unset.
    vi.stubEnv('CHANNEX_API_KEY', 'test-key');
    // (CHANNEX_WEBHOOK_SECRET intentionally not stubbed → unset)
    const t = makeT();
    await seed(t);
    const res = await t.action(internal.channel.ingest.handleWebhookNudge, {
      headers: {},
    });
    expect(res.status).toBe(200);
    // An unauthenticated caller can never make us hit Channex or write rows: the
    // 2-min poll cron is authoritative; the nudge only exists behind a secret.
    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    );
    const polls = scheduled.filter((j) => JSON.stringify(j.name ?? '').includes('syncBookingRevisions'));
    expect(polls).toHaveLength(0);
    const logs = await t.run(async (ctx) => ctx.db.query('channelSyncLog').collect());
    expect(logs).toHaveLength(0);
    await drainAll();
  });

  it('accepts a matching secret and schedules a poll', async () => {
    vi.stubEnv('CHANNEX_API_KEY', 'test-key');
    vi.stubEnv('CHANNEX_WEBHOOK_SECRET', 'sekret');
    // Feed + ack mock so the scheduled poll drains cleanly.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ data: [], meta: { total_pages: 1 } }), { status: 200 })),
    );
    const t = makeT();
    await seed(t);
    const res = await t.action(internal.channel.ingest.handleWebhookNudge, {
      headers: { 'x-channex-webhook-secret': 'sekret' },
    });
    expect(res.status).toBe(200);
    // The poll WAS scheduled (authenticated).
    const scheduled = await t.run(async (ctx) =>
      ctx.db.system.query('_scheduled_functions').collect(),
    );
    const polls = scheduled.filter((j) => JSON.stringify(j.name ?? '').includes('syncBookingRevisions'));
    expect(polls.length).toBeGreaterThanOrEqual(1);
    await drainAll();
  });
});
