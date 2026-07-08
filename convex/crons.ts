import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

// Release stale pre-payment holds (35-min TTL; see bookings.HOLD_TTL_MS).
crons.interval('expire stale holds', { minutes: 2 }, internal.bookings.expireHolds, {});

// Pull external calendars (Airbnb etc.) into unitNights. No-op until a unit
// has icalImports entries; per-feed failures are isolated inside syncAll.
crons.interval('ical import sync', { minutes: 15 }, internal.icalImport.syncAll, {});

// Channel manager (Channex) — all no-ops until a property is connected +
// CHANNEX_API_KEY is set. Flush dirty availability to OTAs every minute (the
// oversell-window ceiling for changes not covered by the immediate post-hold
// push); poll the booking-revisions feed every 2 min (webhooks are only
// nudges); full resync nightly as the reconciliation backstop.
crons.interval('channex ari flush', { minutes: 1 }, internal.channel.ari.flushDirty, {});
crons.interval('channex booking poll', { minutes: 2 }, internal.channel.ingest.syncBookingRevisions, {});
crons.daily('channex full resync', { hourUTC: 8, minuteUTC: 30 }, internal.channel.ari.flushDirty, {
  fullResync: true,
});

// Demo deployment only: reset writable demo data nightly (09:00 UTC ≈ 3am MT).
// The mutation itself refuses to run unless DEMO_MODE=true, so registering it
// unconditionally is safe for real deployments.
crons.daily('demo reset', { hourUTC: 9, minuteUTC: 0 }, internal.demo.reset, {});

export default crons;
