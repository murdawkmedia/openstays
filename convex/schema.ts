import { defineSchema, defineTable } from 'convex/server';
import { authTables } from '@convex-dev/auth/server';
import { v } from 'convex/values';
import { consensusRewardSats } from './rewardPolicy';

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

export const operationalRole = v.union(
  v.literal('owner'),
  v.literal('manager'),
  v.literal('front_desk'),
  v.literal('housekeeping'),
  v.literal('accounting'),
);

export const unitAttributesSchema = v.object({
  siteLengthFeet: v.optional(v.number()),
  hookups: v.optional(
    v.array(
      v.union(
        v.literal('15_amp'),
        v.literal('30_amp'),
        v.literal('50_amp'),
        v.literal('water'),
        v.literal('sewer'),
      ),
    ),
  ),
  parkingStyle: v.optional(
    v.union(v.literal('back_in'), v.literal('pull_through'), v.literal('not_applicable')),
  ),
  accessible: v.optional(v.boolean()),
  petPolicy: v.optional(
    v.union(v.literal('allowed'), v.literal('restricted'), v.literal('not_allowed')),
  ),
});

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

  // Property-scoped operational authority. The legacy staffProfiles role is
  // retained during the additive migration, but command-center mutations use
  // these assignments once a profile has any scoped rows.
  staffPropertyAssignments: defineTable({
    staffProfileId: v.id('staffProfiles'),
    userId: v.id('users'),
    propertyId: v.id('properties'),
    role: operationalRole,
    active: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_profile', ['staffProfileId'])
    .index('by_user', ['userId'])
    .index('by_property', ['propertyId'])
    .index('by_profile_property', ['staffProfileId', 'propertyId']),

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

  // Per-property rollout switches. Features are additive and disabled until a
  // property explicitly opts in after its acceptance gates pass.
  propertyFeatures: defineTable({
    propertyId: v.id('properties'),
    feature: v.string(),
    enabled: v.boolean(),
    version: v.number(),
    updatedBy: v.id('users'),
    updatedAt: v.number(),
  })
    .index('by_property', ['propertyId'])
    .index('by_property_feature', ['propertyId', 'feature']),

  // Generic mutation idempotency ledger for staff operational workflows.
  operationRequests: defineTable({
    propertyId: v.id('properties'),
    requestId: v.string(),
    action: v.string(),
    actorUserId: v.id('users'),
    resultJson: v.string(),
    createdAt: v.number(),
  })
    .index('by_property_request', ['propertyId', 'requestId'])
    .index('by_property_createdAt', ['propertyId', 'createdAt']),

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
    attributes: v.optional(unitAttributesSchema),
    attributesVersion: v.optional(v.number()),
  })
    .index('by_property', ['propertyId', 'sortOrder'])
    .index('by_type', ['unitTypeId'])
    .index('by_icalToken', ['icalExportToken']),

  unitGroups: defineTable({
    propertyId: v.id('properties'),
    name: v.string(),
    slug: v.string(),
    active: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_property', ['propertyId'])
    .index('by_property_slug', ['propertyId', 'slug']),

  unitGroupMembers: defineTable({
    propertyId: v.id('properties'),
    unitGroupId: v.id('unitGroups'),
    unitId: v.id('units'),
    addedBy: v.id('users'),
    addedAt: v.number(),
  })
    .index('by_group', ['unitGroupId'])
    .index('by_unit', ['unitId'])
    .index('by_group_unit', ['unitGroupId', 'unitId']),

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
    publicPaymentConsent: v.optional(v.object({
      version: v.string(),
      acceptedAt: v.number(),
      rail: v.union(v.literal('zaprite'), v.literal('wavelength')),
    })),
    createdAt: v.number(),
    updatedAt: v.number(),
    version: v.optional(v.number()),
  })
    .index('by_unit_checkIn', ['unitId', 'checkIn'])
    .index('by_status_holdExpires', ['status', 'holdExpiresAt'])
    .index('by_property_checkIn', ['propertyId', 'checkIn'])
    .index('by_guest', ['guestId'])
    .index('by_confirmationCode', ['confirmationCode'])
    .index('by_unit_externalUid', ['unitId', 'externalUid'])
    .index('by_channelBooking', ['channelBookingId']),

  // Quotes and waitlist entries are explicitly non-blocking. Only quote
  // acceptance creates a normal booking hold and unitNights rows.
  quotes: defineTable({
    propertyId: v.id('properties'),
    guestId: v.id('guests'),
    unitTypeId: v.id('unitTypes'),
    unitId: v.optional(v.id('units')),
    ratePlanId: v.id('ratePlans'),
    checkIn: v.string(),
    checkOut: v.string(),
    adults: v.number(),
    children: v.number(),
    amountCents: v.number(),
    gstCents: v.number(),
    currency: v.string(),
    priceBreakdown: priceBreakdownSchema,
    status: v.union(
      v.literal('draft'),
      v.literal('sent'),
      v.literal('accepted'),
      v.literal('declined'),
      v.literal('expired'),
    ),
    expiresAt: v.number(),
    convertedBookingId: v.optional(v.id('bookings')),
    version: v.number(),
    createdBy: v.id('users'),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_property_status', ['propertyId', 'status'])
    .index('by_guest', ['guestId'])
    .index('by_expiry', ['status', 'expiresAt']),

  waitlistEntries: defineTable({
    propertyId: v.id('properties'),
    guestId: v.id('guests'),
    unitTypeId: v.id('unitTypes'),
    desiredCheckIn: v.string(),
    desiredCheckOut: v.string(),
    adults: v.number(),
    children: v.number(),
    flexibility: v.string(),
    status: v.union(v.literal('open'), v.literal('contacted'), v.literal('converted'), v.literal('closed')),
    quoteId: v.optional(v.id('quotes')),
    version: v.number(),
    createdBy: v.id('users'),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_property_status', ['propertyId', 'status'])
    .index('by_guest', ['guestId']),

  staffTasks: defineTable({
    propertyId: v.id('properties'),
    bookingId: v.optional(v.id('bookings')),
    quoteId: v.optional(v.id('quotes')),
    waitlistEntryId: v.optional(v.id('waitlistEntries')),
    kind: v.union(v.literal('call'), v.literal('follow_up'), v.literal('reminder')),
    title: v.string(),
    detail: v.string(),
    status: v.union(v.literal('open'), v.literal('completed'), v.literal('cancelled')),
    assignedStaffProfileId: v.optional(v.id('staffProfiles')),
    dueAt: v.optional(v.number()),
    version: v.number(),
    createdBy: v.id('users'),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index('by_property_status', ['propertyId', 'status'])
    .index('by_assignee_status', ['assignedStaffProfileId', 'status'])
    .index('by_booking', ['bookingId']),

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

  maintenanceTasks: defineTable({
    propertyId: v.id('properties'),
    unitId: v.id('units'),
    title: v.string(),
    description: v.string(),
    priority: v.union(v.literal('low'), v.literal('normal'), v.literal('high'), v.literal('urgent')),
    status: v.union(v.literal('open'), v.literal('in_progress'), v.literal('resolved'), v.literal('cancelled')),
    removesInventory: v.boolean(),
    linkedBlockBookingId: v.optional(v.id('bookings')),
    assignedStaffProfileId: v.optional(v.id('staffProfiles')),
    version: v.number(),
    createdBy: v.id('users'),
    createdAt: v.number(),
    updatedAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index('by_property_status', ['propertyId', 'status'])
    .index('by_unit_status', ['unitId', 'status'])
    .index('by_assignee_status', ['assignedStaffProfileId', 'status']),

  unitServiceStates: defineTable({
    propertyId: v.id('properties'),
    unitId: v.id('units'),
    state: v.union(
      v.literal('ready'),
      v.literal('dirty'),
      v.literal('cleaning'),
      v.literal('inspection'),
      v.literal('do_not_disturb'),
      v.literal('out_of_service'),
    ),
    note: v.optional(v.string()),
    version: v.number(),
    updatedBy: v.id('users'),
    updatedAt: v.number(),
  })
    .index('by_property_state', ['propertyId', 'state'])
    .index('by_unit', ['unitId']),

  housekeepingAssignments: defineTable({
    propertyId: v.id('properties'),
    unitId: v.id('units'),
    serviceDate: v.string(),
    assignedStaffProfileId: v.optional(v.id('staffProfiles')),
    priority: v.number(),
    status: v.union(v.literal('assigned'), v.literal('in_progress'), v.literal('ready_for_inspection'), v.literal('verified'), v.literal('cancelled')),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    verifiedAt: v.optional(v.number()),
    version: v.number(),
    createdBy: v.id('users'),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_property_date', ['propertyId', 'serviceDate'])
    .index('by_assignee_date', ['assignedStaffProfileId', 'serviceDate'])
    .index('by_unit_date', ['unitId', 'serviceDate']),

  folios: defineTable({
    propertyId: v.id('properties'),
    bookingId: v.optional(v.id('bookings')),
    guestId: v.optional(v.id('guests')),
    kind: v.union(v.literal('booking'), v.literal('retail')),
    status: v.union(v.literal('open'), v.literal('closed'), v.literal('void')),
    currency: v.string(),
    version: v.number(),
    createdBy: v.id('users'),
    createdAt: v.number(),
    updatedAt: v.number(),
    closedAt: v.optional(v.number()),
  })
    .index('by_property_status', ['propertyId', 'status'])
    .index('by_booking', ['bookingId']),

  folioEntries: defineTable({
    propertyId: v.id('properties'),
    folioId: v.id('folios'),
    kind: v.union(
      v.literal('charge'),
      v.literal('adjustment'),
      v.literal('payment'),
      v.literal('refund'),
      v.literal('reversal'),
    ),
    description: v.string(),
    amountCents: v.number(),
    taxCents: v.number(),
    paymentId: v.optional(v.id('payments')),
    reversesEntryId: v.optional(v.id('folioEntries')),
    postedBy: v.id('users'),
    postedAt: v.number(),
  })
    .index('by_folio_postedAt', ['folioId', 'postedAt'])
    .index('by_property_postedAt', ['propertyId', 'postedAt'])
    .index('by_payment', ['paymentId'])
    .index('by_reversal', ['reversesEntryId']),

  complimentaryAuthorizations: defineTable({
    propertyId: v.id('properties'),
    bookingId: v.id('bookings'),
    originalValueCents: v.number(),
    reason: v.string(),
    status: v.union(v.literal('requested'), v.literal('approved'), v.literal('declined'), v.literal('reversed')),
    requestedBy: v.id('users'),
    resolvedBy: v.optional(v.id('users')),
    createdAt: v.number(),
    updatedAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index('by_booking', ['bookingId'])
    .index('by_property_status', ['propertyId', 'status']),

  rateAdjustments: defineTable({
    propertyId: v.id('properties'),
    bookingId: v.id('bookings'),
    originalTotalCents: v.number(),
    adjustedTotalCents: v.number(),
    reason: v.string(),
    authorizedBy: v.id('users'),
    createdAt: v.number(),
  }).index('by_booking', ['bookingId']),

  nightAuditSnapshots: defineTable({
    propertyId: v.id('properties'),
    businessDate: v.string(),
    status: v.union(v.literal('draft'), v.literal('closed'), v.literal('reopened')),
    summaryJson: v.string(),
    closedBy: v.optional(v.id('users')),
    createdAt: v.number(),
    updatedAt: v.number(),
    closedAt: v.optional(v.number()),
  }).index('by_property_date', ['propertyId', 'businessDate']),

  groupReservations: defineTable({
    propertyId: v.id('properties'),
    name: v.string(),
    contactGuestId: v.id('guests'),
    arrivalDate: v.string(),
    departureDate: v.string(),
    status: v.union(v.literal('prospect'), v.literal('held'), v.literal('confirmed'), v.literal('completed'), v.literal('cancelled')),
    bookingIds: v.array(v.id('bookings')),
    contractStorageId: v.optional(v.id('_storage')),
    version: v.number(),
    createdBy: v.id('users'),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_property_status', ['propertyId', 'status'])
    .index('by_contact', ['contactGuestId']),

  operationalSearchDocuments: defineTable({
    propertyId: v.id('properties'),
    recordType: v.string(),
    recordId: v.string(),
    title: v.string(),
    subtitle: v.string(),
    normalizedText: v.string(),
    status: v.string(),
    source: v.optional(v.string()),
    dateStart: v.optional(v.string()),
    dateEnd: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index('by_property_type', ['propertyId', 'recordType'])
    .index('by_property_status', ['propertyId', 'status'])
    .index('by_property_updatedAt', ['propertyId', 'updatedAt']),

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
    providerReconciliationId: v.optional(v.string()),
    providerCheckoutConfigId: v.optional(v.string()),
    providerExpiresAt: v.optional(v.number()),
    consentVersion: v.optional(v.string()),
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
    network: v.union(v.literal('signet'), v.literal('mainnet')),
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

  consensusReceipts: defineTable({
    propertyId: v.id('properties'),
    bookingId: v.id('bookings'),
    publicId: v.string(),
    schemaVersion: v.literal('openstays.consensus-receipt.v1'),
    canonicalJson: v.string(),
    sha256: v.string(),
    status: v.union(
      v.literal('queued'), v.literal('stamping'), v.literal('submitted'),
      v.literal('bitcoin_anchored'), v.literal('failed'),
    ),
    proofBase64: v.optional(v.string()),
    calendarCount: v.optional(v.number()),
    leaseToken: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    failureReason: v.optional(v.string()),
    bitcoinBlockHeight: v.optional(v.number()),
    bitcoinBlockTime: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    submittedAt: v.optional(v.number()),
    anchoredAt: v.optional(v.number()),
  })
    .index('by_booking', ['bookingId'])
    .index('by_publicId', ['publicId'])
    .index('by_status_createdAt', ['status', 'createdAt']),

  wavelengthRewards: defineTable({
    propertyId: v.id('properties'),
    bookingId: v.id('bookings'),
    receiptId: v.id('consensusReceipts'),
    network: v.literal('signet'),
    satsAmount: consensusRewardSats,
    status: v.union(
      v.literal('eligible'), v.literal('invoice_ready'), v.literal('paying'),
      v.literal('paid'), v.literal('expired'), v.literal('failed'),
    ),
    bolt11: v.optional(v.string()),
    invoiceExpiresAt: v.optional(v.number()),
    attemptCount: v.number(),
    merchantActivityId: v.optional(v.string()),
    paymentHash: v.optional(v.string()),
    leaseToken: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    failureReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    paidAt: v.optional(v.number()),
  })
    .index('by_booking', ['bookingId'])
    .index('by_receipt', ['receiptId'])
    .index('by_status_createdAt', ['status', 'createdAt']),

  treasurySweeps: defineTable({
    network: v.literal('signet'),
    destinationAddress: v.string(),
    balanceSnapshotSats: v.number(),
    baseReserveSats: v.number(),
    rewardLiabilitySats: v.number(),
    refundLiabilitySats: v.number(),
    requiredReserveSats: v.number(),
    feeAllowanceSats: v.number(),
    authorizedAmountSats: v.number(),
    preparedAmountSats: v.optional(v.number()),
    preparedFeeSats: v.optional(v.number()),
    preparedTotalOutflowSats: v.optional(v.number()),
    actualAmountSats: v.optional(v.number()),
    actualFeeSats: v.optional(v.number()),
    actualTotalOutflowSats: v.optional(v.number()),
    status: v.union(
      v.literal('prepared'),
      v.literal('dispatched'),
      v.literal('completed'),
      v.literal('failed'),
      v.literal('reconciliation_required'),
    ),
    leaseToken: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    sendIntentId: v.optional(v.string()),
    merchantActivityId: v.optional(v.string()),
    transactionId: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    dispatchedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index('by_status_createdAt', ['status', 'createdAt'])
    .index('by_destination_createdAt', ['destinationAddress', 'createdAt']),

  publicRewardClaims: defineTable({
    propertyId: v.id('properties'),
    bookingId: v.id('bookings'),
    rewardId: v.id('wavelengthRewards'),
    receiptId: v.id('consensusReceipts'),
    tokenId: v.string(),
    emailDigest: v.string(),
    deviceDigest: v.string(),
    networkDigest: v.string(),
    network: v.literal('signet'),
    satsAmount: v.literal(1_000),
    status: v.union(
      v.literal('accepted'),
      v.literal('paid'),
      v.literal('failed'),
    ),
    claimedAt: v.number(),
    paidAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_tokenId', ['tokenId'])
    .index('by_booking', ['bookingId'])
    .index('by_email_claimedAt', ['emailDigest', 'claimedAt'])
    .index('by_device_claimedAt', ['deviceDigest', 'claimedAt'])
    .index('by_network_claimedAt', ['networkDigest', 'claimedAt'])
    .index('by_status_claimedAt', ['status', 'claimedAt']),

  bridgeHealth: defineTable({
    service: v.union(
      v.literal('wavelength'),
      v.literal('ots'),
      v.literal('mail'),
      v.literal('backup'),
    ),
    status: v.union(
      v.literal('starting'),
      v.literal('ready'),
      v.literal('degraded'),
      v.literal('failed'),
    ),
    release: v.string(),
    lastHeartbeatAt: v.number(),
    spendableSats: v.optional(v.number()),
    backupGeneration: v.optional(v.number()),
    backupDigest: v.optional(v.string()),
    backupCreatedAt: v.optional(v.number()),
    failureCategory: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_service', ['service']),

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
    from: v.optional(v.string()),
    templateKey: v.string(),
    subject: v.string(),
    html: v.optional(v.string()),
    text: v.optional(v.string()),
    provider: v.optional(v.union(v.literal('resend'), v.literal('mail_bridge'), v.literal('log_only'))),
    idempotencyKey: v.optional(v.string()),
    bookingId: v.optional(v.id('bookings')),
    seasonalContractId: v.optional(v.id('seasonalContracts')),
    status: v.union(v.literal('queued'), v.literal('sent'), v.literal('failed'), v.literal('logged')),
    providerMessageId: v.optional(v.string()),
    error: v.optional(v.string()),
    attemptCount: v.optional(v.number()),
    nextAttemptAt: v.optional(v.number()),
    leaseToken: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),
    retentionPurgedAt: v.optional(v.number()),
    ts: v.number(),
  })
    .index('by_booking', ['bookingId'])
    .index('by_ts', ['ts'])
    .index('by_status_nextAttemptAt', ['status', 'nextAttemptAt'])
    .index('by_idempotencyKey', ['idempotencyKey']),

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
    propertyId: v.optional(v.id('properties')),
    entityType: v.optional(v.string()),
    entityId: v.optional(v.string()),
    requestId: v.optional(v.string()),
    metadataJson: v.optional(v.string()),
    ts: v.number(),
  })
    .index('by_ts', ['ts'])
    .index('by_property_ts', ['propertyId', 'ts'])
    .index('by_property_request', ['propertyId', 'requestId']),

  // Staff auth lands in M1 (Convex Auth). Settings is the kokanee-style
  // key/value store for non-secret deployment prefs.
  settings: defineTable({
    key: v.string(),
    value: v.string(), // JSON string
  }).index('by_key', ['key']),
});
