import { internalMutation } from './_generated/server';
import { seedPinewoodFlats } from './seed';

/**
 * DEMO_MODE nightly reset: wipe all domain tables and re-seed Pinewood Flats.
 * Registered as a cron only when the deployment sets DEMO_MODE=true.
 * Never runs (and refuses to run) on non-demo deployments.
 */
export const reset = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (process.env.DEMO_MODE !== 'true') {
      return { reset: false, reason: 'DEMO_MODE is not enabled on this deployment.' };
    }
    const tables = [
      'unitNights',
      'bookingAddOns',
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
    ] as const;
    for (const table of tables) {
      const rows = await ctx.db.query(table).collect();
      for (const row of rows) await ctx.db.delete(row._id);
    }
    await seedPinewoodFlats(ctx);
    return { reset: true };
  },
});
