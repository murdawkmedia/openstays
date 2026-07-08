import { v } from 'convex/values';
import { query } from './_generated/server';

/** Public: property page payload by slug. */
export const bySlug = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const property = await ctx.db
      .query('properties')
      .withIndex('by_slug', (q) => q.eq('slug', args.slug))
      .first();
    if (!property || !property.active) return null;

    const unitTypes = await ctx.db
      .query('unitTypes')
      .withIndex('by_property', (q) => q.eq('propertyId', property._id))
      .collect();

    return {
      propertyId: property._id,
      name: property.name,
      slug: property.slug,
      email: property.email,
      phone: property.phone,
      address: property.address,
      currency: property.currency,
      taxLabel: property.taxLabel,
      checkInTime: property.checkInTime,
      checkOutTime: property.checkOutTime,
      unitTypes: unitTypes
        .filter((t) => t.bookingMode === 'nightly')
        .map((t) => ({
          unitTypeId: t._id,
          name: t.name,
          slug: t.slug,
          kind: t.kind,
          description: t.description,
          photoUrls: t.photoUrls,
          maxOccupancy: t.maxOccupancy,
          amenities: t.amenities,
          comingSoon: t.comingSoon,
        })),
    };
  },
});

/**
 * Public contact/config snapshot the checkout & confirmation pages consume.
 * Intentionally public (no auth), so it must NOT leak sensitive or unlaunched
 * config: ACTIVE properties only, and NO gstNumber (the tax-registration
 * number). The full config (incl. gstNumber, taxRateBps, timezone) lives behind
 * staff auth in staff.forSettings.
 */
export const configList = query({
  args: {},
  handler: async (ctx) => {
    const properties = await ctx.db.query('properties').collect();
    return properties
      .filter((p) => p.active)
      .map((p) => ({
        propertyId: p._id,
        name: p.name,
        slug: p.slug,
        active: p.active,
        currency: p.currency,
        taxLabel: p.taxLabel,
        email: p.email,
        phone: p.phone,
        address: p.address,
        checkInTime: p.checkInTime,
        checkOutTime: p.checkOutTime,
      }));
  },
});

/** Public: list all active properties (home page). */
export const listActive = query({
  args: {},
  handler: async (ctx) => {
    const properties = await ctx.db.query('properties').collect();
    return properties
      .filter((p) => p.active)
      .map((p) => ({ propertyId: p._id, name: p.name, slug: p.slug, address: p.address }));
  },
});

/** Public: unit type detail + its active rate plan + units. */
export const unitTypeBySlug = query({
  args: { propertySlug: v.string(), unitTypeSlug: v.string() },
  handler: async (ctx, args) => {
    const property = await ctx.db
      .query('properties')
      .withIndex('by_slug', (q) => q.eq('slug', args.propertySlug))
      .first();
    if (!property || !property.active) return null;

    const unitType = await ctx.db
      .query('unitTypes')
      .withIndex('by_property_slug', (q) =>
        q.eq('propertyId', property._id).eq('slug', args.unitTypeSlug),
      )
      .first();
    if (!unitType) return null;

    const ratePlan = await ctx.db
      .query('ratePlans')
      .withIndex('by_unitType', (q) => q.eq('unitTypeId', unitType._id).eq('active', true))
      .first();

    const addOns = await ctx.db
      .query('addOns')
      .withIndex('by_property', (q) => q.eq('propertyId', property._id).eq('active', true))
      .collect();

    return {
      property: {
        propertyId: property._id,
        name: property.name,
        slug: property.slug,
        taxRateBps: property.taxRateBps,
        taxLabel: property.taxLabel,
        currency: property.currency,
      },
      unitType: {
        unitTypeId: unitType._id,
        name: unitType.name,
        slug: unitType.slug,
        kind: unitType.kind,
        description: unitType.description,
        photoUrls: unitType.photoUrls,
        maxOccupancy: unitType.maxOccupancy,
        amenities: unitType.amenities,
        comingSoon: unitType.comingSoon,
      },
      ratePlan: ratePlan
        ? {
            ratePlanId: ratePlan._id,
            name: ratePlan.name,
            baseNightlyCents: ratePlan.baseNightlyCents,
            weeklyRateCents: ratePlan.weeklyRateCents,
            seasons: ratePlan.seasons,
            minStayNights: ratePlan.minStayNights,
            maxStayNights: ratePlan.maxStayNights,
            minLeadTimeHours: ratePlan.minLeadTimeHours,
            maxAdvanceDays: ratePlan.maxAdvanceDays,
            prepBufferNights: ratePlan.prepBufferNights,
            depositPolicy: ratePlan.depositPolicy,
            cancellationPolicy: ratePlan.cancellationPolicy,
          }
        : null,
      addOns: addOns
        .filter((a) => a.appliesTo.length === 0 || a.appliesTo.includes(unitType._id))
        .map((a) => ({
          addOnId: a._id,
          name: a.name,
          priceCents: a.priceCents,
          taxable: a.taxable,
          unitLabel: a.unitLabel,
        })),
    };
  },
});
