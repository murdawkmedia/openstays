import { ConvexError, v } from 'convex/values';
import { mutation, query } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { requireStaff } from '../staff';

// ---------------------------------------------------------------------------
// Admin-facing channel config (M6-prep) — powers the /admin/settings Channels
// section. Staff-gated (owner to change connection; any staff to view), with
// the usual DEMO_MODE carve-out. Builder implements the stubs; signatures FIXED
// (the settings UI codes against them). Secrets (CHANNEX_API_KEY) are NEVER set
// here — only the non-secret mapping (Channex UUIDs) + the enabled toggle.
// ---------------------------------------------------------------------------

async function gate(ctx: Parameters<typeof requireStaff>[0], ownerOnly: boolean) {
  if (process.env.DEMO_MODE === 'true') return;
  const { profile } = await requireStaff(ctx);
  if (ownerOnly && profile.role !== 'owner') throw new ConvexError('OWNER_ONLY');
}

/**
 * Channel config + live status for the settings page: whether the channel
 * manager is configured (env), each property's channexPropertyId + enabled +
 * last push/poll/error, and per-unitType / per-ratePlan mapping ids. (builder)
 */
export const getChannelConfig = query({
  args: {},
  handler: async (): Promise<{
    configured: boolean; // CHANNEX_API_KEY present
    baseUrl: string;
    properties: Array<{
      propertyId: Id<'properties'>;
      name: string;
      channexPropertyId?: string;
      enabled: boolean;
      dirtySince?: number;
      lastAriPushAt?: number;
      lastBookingPollAt?: number;
      lastError?: string;
      unitTypes: Array<{ unitTypeId: Id<'unitTypes'>; name: string; channexRoomTypeId?: string }>;
      ratePlans: Array<{ ratePlanId: Id<'ratePlans'>; name: string; channexRatePlanId?: string }>;
    }>;
  }> => {
    throw new ConvexError('NOT_IMPLEMENTED'); // builder
  },
});

/** Set/clear a property's Channex property UUID + enabled toggle (owner). Creates
 *  the channelSync row on first connect. (builder) */
export const setPropertyChannel = mutation({
  args: {
    propertyId: v.id('properties'),
    channexPropertyId: v.optional(v.string()), // undefined/'' disconnects
    enabled: v.boolean(),
  },
  handler: async (): Promise<{ ok: boolean }> => {
    throw new ConvexError('NOT_IMPLEMENTED'); // builder
  },
});

/** Map a unitType → Channex room type UUID (owner). (builder) */
export const setUnitTypeChannel = mutation({
  args: { unitTypeId: v.id('unitTypes'), channexRoomTypeId: v.optional(v.string()) },
  handler: async (): Promise<{ ok: boolean }> => {
    throw new ConvexError('NOT_IMPLEMENTED'); // builder
  },
});

/** Map a ratePlan → Channex rate plan UUID (owner). (builder) */
export const setRatePlanChannel = mutation({
  args: { ratePlanId: v.id('ratePlans'), channexRatePlanId: v.optional(v.string()) },
  handler: async (): Promise<{ ok: boolean }> => {
    throw new ConvexError('NOT_IMPLEMENTED'); // builder
  },
});

/** Recent channelSyncLog rows for a property (newest first). (builder) */
export const recentSyncLog = query({
  args: { propertyId: v.id('properties'), limit: v.optional(v.number()) },
  handler: async (): Promise<
    Array<{ kind: string; ok: boolean; detail: string; ts: number }>
  > => {
    throw new ConvexError('NOT_IMPLEMENTED'); // builder
  },
});

/** Force an immediate ARI push for a property (a "Sync now" button). Owner.
 *  Schedules internal.channel.ari.pushAriForProperty. (builder) */
export const syncNow = mutation({
  args: { propertyId: v.id('properties') },
  handler: async (): Promise<{ scheduled: boolean }> => {
    throw new ConvexError('NOT_IMPLEMENTED'); // builder
  },
});

// silence unused-import in the stub phase
void gate;
