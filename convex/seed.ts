import { internalMutation } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { CONSENSUS_COMMONS_PHOTO_URLS } from '../shared/consensusCommonsExperience';

/**
 * Seed the fictional "Pinewood Flats Campground" — the ONLY inventory that
 * ever lives in this repo. Real operators load their own inventory as data
 * in their own deployment (see docs/configuration.md).
 *
 * Run with: npx convex run seed:run
 * Idempotent: skips if the property already exists.
 */
export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    const pinewood = await ctx.db
      .query('properties')
      .withIndex('by_slug', (q) => q.eq('slug', 'pinewood-flats'))
      .first();
    const commons = await ctx.db
      .query('properties')
      .withIndex('by_slug', (q) => q.eq('slug', 'consensus-commons'))
      .first();
    if (!pinewood) await seedPinewoodFlats(ctx);
    if (!commons) await seedConsensusCommons(ctx);
    else await refreshConsensusCommons(ctx, commons._id);
    return { seeded: !pinewood || !commons, pinewoodSeeded: !pinewood, consensusCommonsSeeded: !commons };
  },
});

/** Keep existing fictional demo deployments aligned with binding hackathon invariants. */
async function refreshConsensusCommons(
  ctx: MutationCtx,
  propertyId: Id<'properties'>,
): Promise<void> {
  await ctx.db.patch(propertyId, { taxRateBps: 1300, taxLabel: 'HST' });
  const nodeRoom = await ctx.db
    .query('unitTypes')
    .withIndex('by_property_slug', (q) => q.eq('propertyId', propertyId).eq('slug', 'node-room'))
    .first();
  if (!nodeRoom) return;
  await ctx.db.patch(nodeRoom._id, { photoUrls: [...CONSENSUS_COMMONS_PHOTO_URLS] });
  await ensureConsensusPromo(ctx, propertyId, nodeRoom._id);
  const ratePlan = await ctx.db
    .query('ratePlans')
    .withIndex('by_unitType', (q) => q.eq('unitTypeId', nodeRoom._id).eq('active', true))
    .first();
  if (!ratePlan) return;
  await ctx.db.patch(ratePlan._id, {
    baseNightlyCents: 19,
    minStayNights: 1,
    maxStayNights: 1,
  });
}

/** Fictional, judge-safe Bitcoin++ Toronto demo inventory. */
export async function seedConsensusCommons(ctx: MutationCtx): Promise<void> {
  const propertyId = await ctx.db.insert('properties', {
    name: 'Consensus Commons',
    slug: 'consensus-commons',
    timezone: 'America/Toronto',
    currency: 'CAD',
    taxRateBps: 1300,
    taxLabel: 'HST',
    email: 'hosts@consensuscommons.example',
    phone: '555-021-0724',
    address: '21 Open Block Way, Toronto, ON',
    checkInTime: '15:00',
    checkOutTime: '11:00',
    active: true,
  });
  const roomTypeId = await ctx.db.insert('unitTypes', {
    propertyId,
    name: 'Node Room',
    slug: 'node-room',
    kind: 'room',
    bookingMode: 'nightly',
    description: 'A fictional conference stay where independent payment rails converge on one conflict-proof reservation state.',
    photoUrls: [...CONSENSUS_COMMONS_PHOTO_URLS],
    maxOccupancy: 2,
    amenities: ['Fast Wi-Fi', 'Shared hack lounge', 'Signet faucet guide', 'Late-night coffee'],
    comingSoon: false,
    sortOrder: 1,
  });
  await ensureConsensusPromo(ctx, propertyId, roomTypeId);
  for (let i = 1; i <= 4; i += 1) {
    await ctx.db.insert('units', {
      propertyId, unitTypeId: roomTypeId, name: `Node ${i}`, slug: `node-${i}`,
      status: 'active', icalExportToken: seedToken(`consensus-node-${i}`), icalImports: [], sortOrder: i,
    });
  }
  await ctx.db.insert('ratePlans', {
    propertyId, unitTypeId: roomTypeId, name: 'Hackathon rate', active: true, currency: 'CAD',
    // 19 cents + rounded 13% HST (2 cents) = the fixed CAD 0.21 / 210-sat demo.
    baseNightlyCents: 19, seasons: [], minStayNights: 1, maxStayNights: 1,
    minLeadTimeHours: 0, maxAdvanceDays: 365, prepBufferNights: 0,
    depositPolicy: { type: 'full', value: 0 },
    cancellationPolicy: [{ daysBefore: 1, refundPercent: 100 }, { daysBefore: 0, refundPercent: 0 }],
  });
}

async function ensureConsensusPromo(
  ctx: MutationCtx,
  propertyId: Id<'properties'>,
  roomTypeId: Id<'unitTypes'>,
): Promise<void> {
  const existing = await ctx.db
    .query('promoCodes')
    .withIndex('by_code', (q) => q.eq('propertyId', propertyId).eq('normalizedCode', 'CONSENSUS10'))
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, {
      code: 'CONSENSUS10',
      kind: 'percent',
      valueBps: 1_000,
      valueCents: undefined,
      description: 'Consensus Commons demo — 10% off the nightly rate',
      oncePerGuest: true,
      appliesToUnitTypes: [roomTypeId],
      active: true,
    });
    return;
  }
  await ctx.db.insert('promoCodes', {
    propertyId,
    code: 'CONSENSUS10',
    normalizedCode: 'CONSENSUS10',
    kind: 'percent',
    valueBps: 1_000,
    description: 'Consensus Commons demo — 10% off the nightly rate',
    oncePerGuest: true,
    appliesToUnitTypes: [roomTypeId],
    active: true,
    redemptionCount: 0,
    createdAt: Date.now(),
  });
}

export async function seedPinewoodFlats(ctx: MutationCtx): Promise<void> {
  const propertyId = await ctx.db.insert('properties', {
    name: 'Pinewood Flats Campground',
    slug: 'pinewood-flats',
    timezone: 'America/Edmonton',
    currency: 'CAD',
    taxRateBps: 500, // 5% GST
    taxLabel: 'GST',
    gstNumber: '123456789RT0001',
    email: 'hello@pinewoodflats.example',
    phone: '555-010-2030',
    address: '1 Lakeshore Drive, Pinewood, AB',
    checkInTime: '16:00',
    checkOutTime: '11:00',
    active: true,
  });

  // --- Cabins ---
  const cabinTypeId = await ctx.db.insert('unitTypes', {
    propertyId,
    name: 'Lakeview Cabin',
    slug: 'lakeview-cabin',
    kind: 'cabin',
    bookingMode: 'nightly',
    description:
      'A cozy one-bedroom cabin with a loft, kitchenette, and a porch looking over the water. Sleeps four comfortably.',
    photoUrls: [],
    maxOccupancy: 4,
    amenities: ['Kitchenette', 'Loft bedroom', 'Porch', 'Fire pit', 'Lake view'],
    comingSoon: false,
    sortOrder: 1,
  });
  for (let i = 1; i <= 3; i += 1) {
    await ctx.db.insert('units', {
      propertyId,
      unitTypeId: cabinTypeId,
      name: `Cabin ${i}`,
      slug: `cabin-${i}`,
      status: 'active',
      icalExportToken: seedToken(`cabin-${i}`),
      icalImports: [],
      sortOrder: i,
    });
  }
  await ctx.db.insert('ratePlans', {
    propertyId,
    unitTypeId: cabinTypeId,
    name: 'Standard',
    active: true,
    currency: 'CAD',
    baseNightlyCents: 14_900,
    weeklyRateCents: 89_400, // 6 nights for 7
    seasons: [
      { label: 'Peak summer', startDate: '2026-06-15', endDate: '2026-09-01', nightlyCents: 18_900, minStayNights: 2 },
    ],
    minStayNights: 1,
    maxStayNights: 21,
    minLeadTimeHours: 0,
    maxAdvanceDays: 365,
    prepBufferNights: 0,
    depositPolicy: { type: 'percent', value: 50 },
    cancellationPolicy: [
      { daysBefore: 7, refundPercent: 100 },
      { daysBefore: 2, refundPercent: 50 },
      { daysBefore: 0, refundPercent: 0 },
    ],
  });

  // --- Yurt ---
  const yurtTypeId = await ctx.db.insert('unitTypes', {
    propertyId,
    name: 'Ridge Yurt',
    slug: 'ridge-yurt',
    kind: 'yurt',
    bookingMode: 'nightly',
    description:
      'Canvas-and-timber glamping on the ridge. Woodstove, queen bed, and the best stars on the property.',
    photoUrls: [],
    maxOccupancy: 2,
    amenities: ['Woodstove', 'Queen bed', 'Shared bathhouse', 'Fire pit'],
    comingSoon: false,
    sortOrder: 2,
  });
  await ctx.db.insert('units', {
    propertyId,
    unitTypeId: yurtTypeId,
    name: 'Yurt 1',
    slug: 'yurt-1',
    status: 'active',
    icalExportToken: seedToken('yurt-1'),
    icalImports: [],
    sortOrder: 1,
  });
  await ctx.db.insert('ratePlans', {
    propertyId,
    unitTypeId: yurtTypeId,
    name: 'Standard',
    active: true,
    currency: 'CAD',
    baseNightlyCents: 11_900,
    seasons: [],
    minStayNights: 1,
    maxStayNights: 14,
    minLeadTimeHours: 0,
    maxAdvanceDays: 365,
    prepBufferNights: 1, // turnover day between glamping stays
    depositPolicy: { type: 'first_night', value: 0 },
    cancellationPolicy: [
      { daysBefore: 3, refundPercent: 100 },
      { daysBefore: 0, refundPercent: 0 },
    ],
  });

  // --- RV sites (nightly) ---
  const siteTypeId = await ctx.db.insert('unitTypes', {
    propertyId,
    name: 'Full-Hookup RV Site',
    slug: 'rv-site',
    kind: 'site',
    bookingMode: 'nightly',
    description: '30/50-amp full-hookup pull-through sites under the pines. Fire ring and picnic table at every site.',
    photoUrls: [],
    maxOccupancy: 8,
    amenities: ['50-amp power', 'Water', 'Sewer', 'Fire ring', 'Picnic table'],
    comingSoon: false,
    sortOrder: 3,
  });
  for (let i = 1; i <= 10; i += 1) {
    await ctx.db.insert('units', {
      propertyId,
      unitTypeId: siteTypeId,
      name: `Site ${100 + i}`,
      slug: `site-${100 + i}`,
      status: 'active',
      icalExportToken: seedToken(`site-${100 + i}`),
      icalImports: [],
      sortOrder: i,
    });
  }
  await ctx.db.insert('ratePlans', {
    propertyId,
    unitTypeId: siteTypeId,
    name: 'Standard',
    active: true,
    currency: 'CAD',
    baseNightlyCents: 6_500,
    weeklyRateCents: 39_000,
    seasons: [],
    minStayNights: 1,
    maxStayNights: 28,
    minLeadTimeHours: 0,
    maxAdvanceDays: 365,
    prepBufferNights: 0,
    depositPolicy: { type: 'full', value: 0 },
    cancellationPolicy: [
      { daysBefore: 2, refundPercent: 100 },
      { daysBefore: 0, refundPercent: 0 },
    ],
  });

  // --- Promo code (demo) ---
  await ctx.db.insert('promoCodes', {
    propertyId,
    code: 'WELCOME10',
    normalizedCode: 'WELCOME10',
    kind: 'percent',
    valueBps: 1_000, // 10% off, pre-tax
    description: 'Welcome discount — 10% off your first stay',
    oncePerGuest: true,
    appliesToUnitTypes: [],
    active: true,
    redemptionCount: 0,
    createdAt: Date.now(),
  });

  // --- Add-ons ---
  await ctx.db.insert('addOns', {
    propertyId,
    name: 'Firewood bundle',
    priceCents: 1_200,
    taxable: true,
    unitLabel: 'bundle',
    appliesTo: [],
    active: true,
    sortOrder: 1,
  });
  await ctx.db.insert('addOns', {
    propertyId,
    name: 'Late checkout (1pm)',
    priceCents: 2_500,
    taxable: true,
    unitLabel: 'stay',
    appliesTo: [cabinTypeId, yurtTypeId],
    active: true,
    sortOrder: 2,
  });
}

/**
 * Deterministic seed tokens so demo iCal URLs are stable across resets.
 * Real deployments generate cryptographically random tokens (M1 admin UI).
 */
function seedToken(slug: string): string {
  return `demo-${slug}-${'x'.repeat(24)}`;
}
