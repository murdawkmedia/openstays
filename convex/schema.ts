import { defineSchema, defineTable } from 'convex/server';
import { authTables } from '@convex-dev/auth/server';
import { v } from 'convex/values';

// ---------------------------------------------------------------------------
// OpenStays schema v1.
// Conventions (binding — see CLAUDE.md):
// - Money is integer cents. Stay dates are property-local ISO 'YYYY-MM-DD'
//   strings (lexicographic == chronological). Epoch ms only for instants.
// - Nights are half-open [checkIn, checkOut).
// - Every domain table carries propertyId (keeps the multi-org door open).
// - unitNights rows are written/deleted ONLY inside the same mutation that
//   changes the owning booking's status. Never touch them elsewhere.
// ---------------------------------------------------------------------------

const statusHistorySchema = v.array(v.object({ status: v.string(), ts: v.number() }));
const noteSchema = v.array(v.object({ ts: v.number(), text: v.string(), by: v.string() }));

export const bookingStatus = v.union(
  v.literal('hold'), // TTL hold, pre-payment
  v.literal('confirmed'), // paid (deposit or full)
  v.literal('checked_in'),
  v.literal('checked_out'),
  v.literal('cancelled'),
  v.literal('expired'), // hold TTL lapsed
  v.literal('no_show'),
  v.literal('external'), // imported via iCal (Airbnb etc.)
  v.literal('blocked'), // maintenance / owner block
  v.literal('payment_conflict'), // payment landed after nights were re-taken
);

// Accounting distinction (binding): a PROMO CODE is a pre-tax price
// reduction — GST is charged on the discounted base, like any merchant
// discount. A GIFT CERTIFICATE is a post-tax payment method — GST is charged
// on the full amount and the certificate pays down the total.
const priceBreakdownSchema = v.object({
  nightlySubtotalCents: v.number(),
  addOnSubtotalCents: v.number(),
  promoDiscountCents: v.number(), // pre-tax reduction
  taxableSubtotalCents: v.number(), // (taxable items − promo allocation)
  gstCents: v.number(), // single rounding on the discounted taxable base
  totalCents: v.number(), // subtotals − promo + gst (the invoice total)
  giftCertAppliedCents: v.number(), // post-tax payment
  depositDueCents: v.number(), // computed on total − giftCertApplied
  balanceDueCents: v.number(),
});

const depositPolicySchema = v.object({
  type: v.union(v.literal('full'), v.literal('percent'), v.literal('flat'), v.literal('first_night')),
  value: v.number(),
});

const cancellationPolicySchema = v.array(
  v.object({
    daysBefore: v.number(),
    refundPercent: v.number(),
  }),
);

export default defineSchema({
  // Convex Auth tables (users, authSessions, authAccounts, ...). Staff sign in
  // with email+password; a users row alone grants NOTHING — staff rights come
  // only from an active staffProfiles row (see convex/staff.ts requireStaff).
  ...authTables,

  staffProfiles: defineTable({
    userId: v.id('users'),
    name: v.string(),
    role: v.union(v.literal('owner'), v.literal('staff')),
    active: v.boolean(),
    createdAt: v.number(),
  }).index('by_userId', ['userId']),

  // Machine credentials for the HTTP API v1 / CLI / MCP surface (M1.5).
  // The raw token ('osk_...') is shown ONCE at creation and never stored —
  // only its SHA-256 hex. Scope 'write' implies 'read'. Automations use
  // these; they never hold a staff login or a deploy key.
  apiKeys: defineTable({
    name: v.string(), // human label, e.g. 'NAS runner (read-only)'
    keyHash: v.string(), // SHA-256 hex of the full token
    prefix: v.string(), // 'osk_ab12cd34' — display/identification only
    scope: v.union(v.literal('read'), v.literal('write')),
    active: v.boolean(),
    createdBy: v.string(),
    createdAt: v.number(),
    lastUsedAt: v.optional(v.number()),
  }).index('by_keyHash', ['keyHash']),

  properties: defineTable({
    name: v.string(),
    slug: v.string(),
    timezone: v.string(), // 'America/Edmonton'
    currency: v.string(), // 'CAD' default; 'USD'/'EUR' offered in settings (shared/currency.ts)
    taxRateBps: v.number(), // 500 = 5% GST
    taxLabel: v.optional(v.string()), // display label: 'GST' (default), 'VAT', 'Sales Tax'
    gstNumber: v.optional(v.string()), // tax registration number shown on receipts
    email: v.string(),
    phone: v.string(),
    address: v.string(),
    checkInTime: v.string(), // '16:00'
    checkOutTime: v.string(), // '11:00'
    active: v.boolean(),
    // Channel manager (Channex) mapping — the Channex Property UUID this maps
    // to. Unset = not connected. Dormant until set + CHANNEX_API_KEY present.
    channexPropertyId: v.optional(v.string()),
  }).index('by_slug', ['slug']),

  unitTypes: defineTable({
    propertyId: v.id('properties'),
    name: v.string(),
    slug: v.string(),
    kind: v.union(
      v.literal('room'),
      v.literal('cabin'),
      v.literal('site'),
      v.literal('rv_rental'),
      v.literal('yurt'),
      v.literal('geodome'),
    ),
    bookingMode: v.union(v.literal('nightly'), v.literal('seasonal')),
    description: v.string(),
    photoUrls: v.array(v.string()),
    maxOccupancy: v.number(),
    amenities: v.array(v.string()),
    comingSoon: v.boolean(),
    sortOrder: v.number(),
    // Channex Room Type UUID. Channex tracks availability as a COUNT per room
    // type per night; OpenStays pushes (active units − occupied units) here.
    channexRoomTypeId: v.optional(v.string()),
  })
    .index('by_property', ['propertyId', 'sortOrder'])
    .index('by_property_slug', ['propertyId', 'slug']),

  units: defineTable({
    propertyId: v.id('properties'),
    unitTypeId: v.id('unitTypes'),
    name: v.string(),
    slug: v.string(),
    status: v.union(v.literal('active'), v.literal('coming_soon'), v.literal('offline')),
    /** Units become bookable online on/after this date; unset = immediately. */
    bookableFrom: v.optional(v.string()),
    icalExportToken: v.string(), // long random secret, regenerable
    icalImports: v.array(
      v.object({
        url: v.string(),
        label: v.string(), // 'Airbnb', 'ResNexus bridge'
        lastSyncedAt: v.optional(v.number()),
        lastStatus: v.optional(v.string()),
      }),
    ),
    sortOrder: v.number(),
  })
    .index('by_property', ['propertyId', 'sortOrder'])
    .index('by_type', ['unitTypeId'])
    .index('by_icalToken', ['icalExportToken']),

  ratePlans: defineTable({
    propertyId: v.id('properties'),
    unitTypeId: v.id('unitTypes'),
    name: v.string(),
    active: v.boolean(),
    currency: v.string(),
    baseNightlyCents: v.number(),
    weeklyRateCents: v.optional(v.number()),
    seasons: v.array(
      v.object({
        label: v.string(),
        startDate: v.string(), // inclusive
        endDate: v.string(), // inclusive
        nightlyCents: v.number(),
        minStayNights: v.optional(v.number()),
      }),
    ),
    minStayNights: v.number(),
    maxStayNights: v.number(),
    minLeadTimeHours: v.number(),
    maxAdvanceDays: v.number(),
    prepBufferNights: v.number(),
    depositPolicy: depositPolicySchema,
    cancellationPolicy: cancellationPolicySchema, // sorted descending by daysBefore
    // Channex Rate Plan UUID (belongs to exactly one Channex room type).
    // OpenStays pushes per-night rates + restrictions here.
    channexRatePlanId: v.optional(v.string()),
  })
    .index('by_unitType', ['unitTypeId', 'active'])
    .index('by_property', ['propertyId']),

  guests: defineTable({
    propertyId: v.id('properties'),
    name: v.string(),
    email: v.string(),
    phone: v.string(),
    normalizedEmail: v.string(),
    normalizedPhone: v.string(),
    marketingOptIn: v.boolean(),
    notes: noteSchema,
  })
    .index('by_email', ['propertyId', 'normalizedEmail'])
    .index('by_phone', ['propertyId', 'normalizedPhone']),

  bookings: defineTable({
    propertyId: v.id('properties'),
    unitId: v.id('units'),
    unitTypeId: v.id('unitTypes'),
    guestId: v.optional(v.id('guests')), // absent for external/blocked
    ratePlanId: v.optional(v.id('ratePlans')),
    checkIn: v.string(), // 'YYYY-MM-DD'
    checkOut: v.string(), // exclusive
    nights: v.number(),
    adults: v.number(),
    children: v.number(),
    status: bookingStatus,
    holdExpiresAt: v.optional(v.number()), // set while status === 'hold'
    source: v.string(), // 'online' | 'front_desk' | 'phone' | 'ical:Airbnb' | 'channel:Booking.com' | 'demo'
    externalUid: v.optional(v.string()), // iCal VEVENT UID for imports
    // Channex booking unique id for OTA reservations ingested via the channel
    // manager (source 'channel:<ota>'). Distinct from iCal's externalUid so the
    // two ingest paths never collide.
    channelBookingId: v.optional(v.string()),
    // iCal import / channel ingest found this external event overlapping an
    // internal booking's nights. The import NEVER clobbers internal bookings —
    // it flags instead and staff resolve on the tape. (An OTA channelBookingId
    // conflict is an oversell to escalate immediately.)
    syncConflict: v.optional(v.boolean()),
    confirmationCode: v.string(), // 'OS-7K3M2Q'
    priceBreakdown: v.optional(priceBreakdownSchema),
    giftCertificateId: v.optional(v.id('giftCertificates')),
    promoCodeId: v.optional(v.id('promoCodes')),
    promoCodeSnapshot: v.optional(v.string()), // code text frozen at booking time
    statusHistory: statusHistorySchema,
    notes: noteSchema,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_unit_checkIn', ['unitId', 'checkIn'])
    .index('by_status_holdExpires', ['status', 'holdExpiresAt'])
    .index('by_property_checkIn', ['propertyId', 'checkIn'])
    .index('by_guest', ['guestId'])
    .index('by_confirmationCode', ['confirmationCode'])
    .index('by_unit_externalUid', ['unitId', 'externalUid'])
    .index('by_channelBooking', ['channelBookingId']),

  // Derived occupancy: one row per blocked unit-night. THE conflict-detection
  // and calendar-rendering surface. Invariant: a row exists iff an active
  // booking (hold/confirmed/checked_in/external/blocked) covers that night.
  unitNights: defineTable({
    unitId: v.id('units'),
    date: v.string(), // 'YYYY-MM-DD'
    bookingId: v.id('bookings'),
    kind: v.union(v.literal('stay'), v.literal('prep'), v.literal('external'), v.literal('block')),
  })
    .index('by_unit_date', ['unitId', 'date'])
    .index('by_booking', ['bookingId']),

  payments: defineTable({
    propertyId: v.id('properties'),
    bookingId: v.optional(v.id('bookings')),
    seasonalContractId: v.optional(v.id('seasonalContracts')),
    provider: v.union(
      v.literal('stripe'),
      v.literal('square'),
      v.literal('zaprite'),
      v.literal('wavelength'),
      v.literal('manual'),
      v.literal('gift_certificate'),
      v.literal('simulated'), // DEMO_MODE only
    ),
    manualMethod: v.optional(v.string()), // 'cash' | 'etransfer' | 'pos_terminal' | 'cheque'
    providerCheckoutId: v.optional(v.string()),
    providerPaymentId: v.optional(v.string()),
    amountCents: v.number(),
    gstCents: v.number(),
    currency: v.string(),
    status: v.union(
      v.literal('pending'),
      v.literal('paid'),
      v.literal('failed'),
      v.literal('refunded'),
      v.literal('partially_refunded'),
    ),
    refunds: v.array(
      v.object({
        amountCents: v.number(),
        providerRefundId: v.optional(v.string()),
        reason: v.string(),
        ts: v.number(),
        by: v.string(),
      }),
    ),
    recordedBy: v.optional(v.string()),
    createdAt: v.number(),
    paidAt: v.optional(v.number()),
  })
    .index('by_booking', ['bookingId'])
    .index('by_contract', ['seasonalContractId'])
    .index('by_provider_checkout', ['provider', 'providerCheckoutId'])
    .index('by_property_createdAt', ['propertyId', 'createdAt']),

  // Providers without a safe refund API remain paid until a staff member
  // records the external refund. One disposition is tracked independently of
  // the append-only payment refund ledger so failures cannot disappear.
  refundCases: defineTable({
    propertyId: v.id('properties'),
    paymentId: v.id('payments'),
    bookingId: v.id('bookings'),
    amountCents: v.number(),
    currency: v.string(),
    reason: v.string(),
    status: v.union(v.literal('open'), v.literal('completed')),
    externalReference: v.optional(v.string()),
    resolvedBy: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index('by_payment_status', ['paymentId', 'status'])
    .index('by_status_createdAt', ['status', 'createdAt'])
    .index('by_booking', ['bookingId']),

  bookingMessages: defineTable({
    propertyId: v.id('properties'),
    bookingId: v.id('bookings'),
    authorRole: v.union(v.literal('guest'), v.literal('staff')),
    authorName: v.string(),
    text: v.string(),
    createdAt: v.number(),
  })
    .index('by_booking_createdAt', ['bookingId', 'createdAt'])
    .index('by_property_createdAt', ['propertyId', 'createdAt']),

  wavelengthRequests: defineTable({
    propertyId: v.id('properties'),
    bookingId: v.id('bookings'),
    paymentId: v.id('payments'),
    quotedAmountCents: v.number(),
    currency: v.string(),
    satsAmount: v.number(),
    bolt11: v.optional(v.string()),
    bridgeActivityId: v.optional(v.string()),
    paymentHash: v.optional(v.string()),
    expiresAt: v.number(),
    status: v.union(
      v.literal('requested'),
      v.literal('claimed'),
      v.literal('invoice_ready'),
      v.literal('settled'),
      v.literal('expired'),
      v.literal('failed'),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    claimedAt: v.optional(v.number()),
    settledAt: v.optional(v.number()),
    failureReason: v.optional(v.string()),
  })
    .index('by_status_createdAt', ['status', 'createdAt'])
    .index('by_booking', ['bookingId'])
    .index('by_payment', ['paymentId']),

  // Webhook idempotency ledger.
  webhookEvents: defineTable({
    provider: v.string(),
    eventId: v.string(),
    type: v.string(),
    bookingId: v.optional(v.id('bookings')),
    processedAt: v.number(),
  }).index('by_provider_event', ['provider', 'eventId']),

  addOns: defineTable({
    propertyId: v.id('properties'),
    name: v.string(),
    priceCents: v.number(),
    taxable: v.boolean(),
    unitLabel: v.string(), // 'bundle', 'night'
    appliesTo: v.array(v.id('unitTypes')), // empty = all
    active: v.boolean(),
    sortOrder: v.number(),
  }).index('by_property', ['propertyId', 'active']),

  bookingAddOns: defineTable({
    bookingId: v.id('bookings'),
    addOnId: v.id('addOns'),
    nameSnapshot: v.string(), // price/name frozen at sale time
    unitPriceCents: v.number(),
    quantity: v.number(),
    taxable: v.boolean(),
    soldAt: v.number(),
    soldBy: v.optional(v.string()),
    paymentId: v.optional(v.id('payments')),
  })
    .index('by_booking', ['bookingId'])
    .index('by_addOn', ['addOnId']),

  // Seasonal (long-term site) contracts — skeletal in M0, implemented in M4.
  seasonalContracts: defineTable({
    propertyId: v.id('properties'),
    unitId: v.id('units'),
    guestId: v.id('guests'),
    seasonLabel: v.string(), // '2027'
    startDate: v.string(),
    endDate: v.string(),
    totalCents: v.number(),
    gstCents: v.number(),
    schedule: v.array(
      v.object({
        dueDate: v.string(),
        amountCents: v.number(),
        status: v.union(v.literal('due'), v.literal('invoiced'), v.literal('paid'), v.literal('overdue')),
        paymentId: v.optional(v.id('payments')),
      }),
    ),
    status: v.union(v.literal('draft'), v.literal('active'), v.literal('completed'), v.literal('cancelled')),
    renewal: v.object({
      status: v.union(v.literal('none'), v.literal('offered'), v.literal('accepted'), v.literal('declined')),
      offeredAt: v.optional(v.number()),
      renewedContractId: v.optional(v.id('seasonalContracts')),
    }),
    agreementPdfStorageId: v.optional(v.id('_storage')),
    statusHistory: statusHistorySchema,
    notes: noteSchema,
  })
    .index('by_unit_season', ['unitId', 'seasonLabel'])
    .index('by_property_status', ['propertyId', 'status'])
    .index('by_guest', ['guestId']),

  // Promo codes — Shopify-style pre-tax discounts. Usage caps stay accurate
  // under concurrency because reserve/apply/release all happen inside the
  // same serializable mutations that move the booking.
  promoCodes: defineTable({
    propertyId: v.id('properties'),
    code: v.string(),
    normalizedCode: v.string(), // uppercase, trimmed
    kind: v.union(v.literal('percent'), v.literal('fixed')),
    valueBps: v.optional(v.number()), // percent: basis points (2000 = 20%)
    valueCents: v.optional(v.number()), // fixed: cents off
    description: v.optional(v.string()),
    startsAt: v.optional(v.number()), // active window (epoch ms)
    endsAt: v.optional(v.number()),
    maxRedemptions: v.optional(v.number()),
    oncePerGuest: v.boolean(),
    minSubtotalCents: v.optional(v.number()),
    appliesToUnitTypes: v.array(v.id('unitTypes')), // empty = all
    active: v.boolean(),
    redemptionCount: v.number(), // maintained transactionally
    createdAt: v.number(),
  }).index('by_code', ['propertyId', 'normalizedCode']),

  promoRedemptions: defineTable({
    promoCodeId: v.id('promoCodes'),
    bookingId: v.id('bookings'),
    normalizedEmail: v.string(),
    discountCents: v.number(),
    status: v.union(v.literal('reserved'), v.literal('applied'), v.literal('released')),
    ts: v.number(),
  })
    .index('by_promo_email', ['promoCodeId', 'normalizedEmail'])
    .index('by_booking', ['bookingId']),

  // Gift certificates — skeletal in M0, redemption wiring lands with M4.
  giftCertificates: defineTable({
    propertyId: v.id('properties'),
    code: v.string(),
    normalizedCode: v.string(), // uppercase, no spaces
    initialCents: v.number(),
    balanceCents: v.number(),
    status: v.union(v.literal('active'), v.literal('depleted'), v.literal('void')),
    expiresAt: v.optional(v.number()),
    recipientName: v.optional(v.string()),
    source: v.union(v.literal('resnexus_migration'), v.literal('issued')),
    ledger: v.array(
      v.object({
        ts: v.number(),
        deltaCents: v.number(), // negative = redemption
        bookingId: v.optional(v.id('bookings')),
        by: v.string(),
      }),
    ),
  }).index('by_code', ['propertyId', 'normalizedCode']),

  emailLog: defineTable({
    propertyId: v.id('properties'),
    to: v.string(),
    templateKey: v.string(),
    subject: v.string(),
    bookingId: v.optional(v.id('bookings')),
    seasonalContractId: v.optional(v.id('seasonalContracts')),
    status: v.union(v.literal('queued'), v.literal('sent'), v.literal('failed'), v.literal('logged')),
    providerMessageId: v.optional(v.string()),
    error: v.optional(v.string()),
    ts: v.number(),
  })
    .index('by_booking', ['bookingId'])
    .index('by_ts', ['ts']),

  // ── Channel manager (Channex) — availability-critical, dormant until a
  // property is mapped + CHANNEX_API_KEY is set. See convex/channel/**. ──────

  // Per-property channel sync state. One row per property once connected.
  channelSync: defineTable({
    propertyId: v.id('properties'),
    provider: v.string(), // 'channex'
    enabled: v.boolean(), // operator toggle; false = built but paused
    dirtySince: v.optional(v.number()), // set on occupancy change; cleared after a push
    lastAriPushAt: v.optional(v.number()),
    lastFullSyncAt: v.optional(v.number()),
    lastBookingPollAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
  }).index('by_property', ['propertyId']),

  // Channel sync history (ARI pushes, booking ingests, acks, errors) — the
  // observability surface for the admin Channels page. Append-only.
  channelSyncLog: defineTable({
    propertyId: v.id('properties'),
    provider: v.string(),
    kind: v.string(), // 'ari_push' | 'booking_ingest' | 'ack' | 'object_sync' | 'error'
    ok: v.boolean(),
    detail: v.string(),
    ts: v.number(),
  }).index('by_property_ts', ['propertyId', 'ts']),

  // Who-did-what audit trail for staff/admin actions (property config, staff
  // grants, API keys, channel config). Append-only; shown in /admin/settings.
  auditLog: defineTable({
    actorUserId: v.optional(v.id('users')), // absent for 'demo' / 'system'
    actorName: v.string(),
    action: v.string(), // 'property.update' | 'staff.grant' | 'apiKey.create' | ...
    detail: v.string(),
    ts: v.number(),
  }).index('by_ts', ['ts']),

  // Staff auth lands in M1 (Convex Auth). Settings is the kokanee-style
  // key/value store for non-secret deployment prefs.
  settings: defineTable({
    key: v.string(),
    value: v.string(), // JSON string
  }).index('by_key', ['key']),
});
