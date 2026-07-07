import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

// Release stale pre-payment holds (35-min TTL; see bookings.HOLD_TTL_MS).
crons.interval('expire stale holds', { minutes: 2 }, internal.bookings.expireHolds, {});

// Pull external calendars (Airbnb etc.) into unitNights. No-op until a unit
// has icalImports entries; per-feed failures are isolated inside syncAll.
crons.interval('ical import sync', { minutes: 15 }, internal.icalImport.syncAll, {});

// Demo deployment only: reset writable demo data nightly (09:00 UTC ≈ 3am MT).
// The mutation itself refuses to run unless DEMO_MODE=true, so registering it
// unconditionally is safe for real deployments.
crons.daily('demo reset', { hourUTC: 9, minuteUTC: 0 }, internal.demo.reset, {});

export default crons;
