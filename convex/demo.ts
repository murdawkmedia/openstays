import { internalMutation } from './_generated/server';
import { ConvexError } from 'convex/values';
import { seedConsensusCommons, seedPinewoodFlats } from './seed';

/**
 * DEMO_MODE nightly reset: wipe all domain tables and re-seed Pinewood Flats.
 * Registered as a cron only when the deployment sets DEMO_MODE=true.
 * Never runs (and refuses to run) on non-demo deployments.
 */
export const reset = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (process.env.PUBLIC_LIVE_PAYMENTS === 'true') {
      throw new ConvexError({
        code: 'LIVE_RESET_PROHIBITED',
        message: 'Destructive demo reset is disabled while public live payments are configured.',
      });
    }
    if (process.env.DEMO_MODE !== 'true') {
      return { reset: false, reason: 'DEMO_MODE is not enabled on this deployment.' };
    }
    const tables = [
      'unitNights',
      'bookingAddOns',
      'refundCases',
      'bookingMessages',
      'wavelengthRequests',
      'wavelengthRewards',
      'consensusReceipts',
      'payments',
      'webhookEvents',
      'promoRedemptions',
      'promoCodes',
      'bookings',
      'guests',
      'giftCertificates',
      'seasonalContracts',
      'emailLog',
      'addOns',
      'ratePlans',
      'units',
      'unitTypes',
      'properties',
      'settings',
      // Demo-minted API keys must NOT outlive a reset: an anonymous demo
      // visitor can mint one (see apiKeys.requireOwnerIdentity's DEMO carve-out),
      // and the '/api/v1' auth path honors any active key independent of
      // DEMO_MODE, so without this wipe a demo key would be a permanent
      // credential surviving every nightly reset. (Adversarial review 2026-07-08.)
      'apiKeys',
      // Channel sync state + history must also NOT outlive a reset. Under
      // DEMO_MODE the admin gate() short-circuits before auth, so an anonymous
      // demo visitor can call setPropertyChannel and create a channelSync row
      // pointing channexPropertyId at an arbitrary UUID. The re-seed replaces the
      // properties rows, but without wiping these two tables the orphaned
      // channelSync / channelSyncLog rows would accumulate forever across nightly
      // resets — and would be a latent real-push hazard if CHANNEX_API_KEY were
      // ever set on a demo deployment. (Adversarial review 2026-07-08.)
      'channelSync',
      'channelSyncLog',
      'auditLog',
    ] as const;
    for (const table of tables) {
      const rows = await ctx.db.query(table).collect();
      for (const row of rows) await ctx.db.delete(row._id);
    }
    await seedPinewoodFlats(ctx);
    await seedConsensusCommons(ctx);
    return { reset: true };
  },
});
