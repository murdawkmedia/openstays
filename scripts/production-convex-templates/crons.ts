import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

crons.interval('expire stale holds', { minutes: 2 }, internal.bookings.expireHolds, {});
crons.interval(
  'zaprite payment reconciliation',
  { minutes: 1 },
  internal.payments.webhooks.reconcileZapritePending,
  { limit: 25 },
);
crons.interval('ical import sync', { minutes: 15 }, internal.icalImport.syncAll, {});
crons.interval('channex ari flush', { minutes: 1 }, internal.channel.ari.flushDirty, {});
crons.interval('channex booking poll', { minutes: 2 }, internal.channel.ingest.syncBookingRevisions, {});
crons.daily('channex full resync', { hourUTC: 8, minuteUTC: 30 }, internal.channel.ari.flushDirty, {
  fullResync: true,
});

export default crons;
