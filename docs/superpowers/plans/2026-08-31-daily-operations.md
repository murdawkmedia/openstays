# Daily Front-Desk and Housekeeping Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add audited front-desk exception flags and complete dated housekeeping assignment, checklist, inspection, export, and history workflows without changing booking, payment, inventory, or channel authority.

**Architecture:** Keep `bookings` and `unitNights` authoritative for occupancy, `payments` authoritative for settlement, and `unitServiceStates` authoritative only for readiness. Add focused property-scoped records and mutation modules, then compose them into the existing front-desk and housekeeping read models, authenticated admin routes, and claim-based API/CLI/MCP path. Ship additively behind `front_desk_exceptions` and `housekeeping_checklists`, with source-controlled fictional public-tour records and no live public mutations.

**Tech Stack:** TypeScript, React 19, React Router 7, Convex, `convex-test`, Vitest, Tailwind CSS, Vite, Playwright, Node.js CLI, MCP SDK, VitePress.

---

**Approved design:** `docs/superpowers/specs/2026-08-31-daily-operations-design.md`

## File and responsibility map

### Shared contracts

- Create `shared/dailyOperations.ts` for flag, cleaning, checklist, filter, and safe-projection literals shared by Convex, React, CLI, and tests.
- Create `shared/dailyOperations.test.ts` for literal guards, bounded text helpers, and query-state normalization.
- Modify `shared/operations.ts` and `shared/operations.test.ts` for the five focused capabilities and fixed role matrix.

### Convex persistence and domain logic

- Modify `convex/schema.ts` with `bookingOperationalFlags`, `housekeepingChecklistTemplates`, `housekeepingChecklistItems`, and optional assignment snapshot/inspection fields.
- Create `convex/dailyOperationsMigration.ts` and `convex/dailyOperationsMigration.test.ts` for an idempotent dry-run/apply migration of open assignments only.
- Create `convex/operationalFlags.ts` and `convex/operationalFlags.test.ts` for create, assign, resolve, list, role isolation, replay, and version conflicts.
- Modify `convex/staff.ts` and `convex/staff.test.ts` with a property-bounded, contact-free assignee picker used by both workspaces.
- Modify `src/components/AdminShell.tsx` so assigned property context carries the already-authoritative property timezone.
- Create `convex/housekeepingTemplates.ts` and `convex/housekeepingTemplates.test.ts` for versioned reusable templates and immutable assignment snapshots.
- Create `convex/housekeepingWork.ts` and `convex/housekeepingWork.test.ts` for dated assignment edits, checklist updates, submission, inspection, and audit projections.
- Modify `convex/frontDesk.ts` and `convex/frontDesk.test.ts` for flag-aware queues and the idempotent checkout-to-turnover handoff.
- Modify `convex/housekeeping.ts` and `convex/housekeeping.test.ts` for additive board fields and backward-compatible assignment creation.

### Staff interface

- Create `src/lib/frontDeskViewState.ts` and `src/lib/frontDeskViewState.test.ts` for URL-backed date, queue, mode, filters, and selected-record state.
- Create `src/components/front-desk/FrontDeskToolbar.tsx`, `FrontDeskQueue.tsx`, and `FrontDeskRecordDrawer.tsx` for focused front-desk rendering and actions.
- Modify `src/pages/AdminFrontDeskPage.tsx` to orchestrate the server read model, mutations, exports, conflict refresh, and deep links.
- Create `src/lib/housekeepingViewState.ts` and `src/lib/housekeepingViewState.test.ts` for Board/Assignments/Audit URL state.
- Create `src/components/housekeeping/HousekeepingToolbar.tsx`, `HousekeepingBoard.tsx`, `HousekeepingAssignments.tsx`, `HousekeepingChecklist.tsx`, and `HousekeepingAudit.tsx` for the three housekeeping workspaces.
- Modify `src/pages/AdminHousekeepingPage.tsx` to orchestrate assignment, checklist, inspection, print, export, and conflict handling.
- Create `tests/dailyOperationsAccessibility.test.ts` for semantic status, focus, keyboard, and bounded-layout source contracts.

### Automation, tour, and documentation

- Modify `convex/apiV1.ts` and `convex/apiV1.test.ts` for bounded reads and accepted daily-operation actions through single-use automation claims.
- Modify `cli/src/client.ts`, `cli/src/client.test.ts`, `cli/src/index.test.ts`, `cli/src/mcp.ts`, and `cli/src/mcp.test.ts` for typed action names and parity tests; the generic CLI and MCP dispatchers remain the only user-facing commands.
- Modify `src/fixtures/publicOperationsFixture.ts` and `tests/publicOperationsTour.test.ts` with fictional exception, checklist, failed-inspection, and verified-unit records only.
- Modify `docs/command-center.md`, `docs/automation.md`, `docs/configuration.md`, and `STATUS.md` with rollout, migration, authority, and rollback instructions.

## Task 1: Lock the shared vocabulary and role capabilities

**Files:**
- Create: `shared/dailyOperations.ts`
- Create: `shared/dailyOperations.test.ts`
- Modify: `shared/operations.ts`
- Modify: `shared/operations.test.ts`

- [ ] **Step 1: Write the failing vocabulary and capability tests**

```ts
// shared/dailyOperations.test.ts
import { describe, expect, it } from 'vitest';
import {
  BOOKING_OPERATIONAL_FLAG_KINDS,
  HOUSEKEEPING_CLEANING_TYPES,
  normalizeDailyOperationsText,
  parseFrontDeskQuery,
} from './dailyOperations';
import { roleCan } from './operations';

describe('daily operations vocabulary', () => {
  it('keeps operational conditions separate from booking status', () => {
    expect(BOOKING_OPERATIONAL_FLAG_KINDS).toEqual([
      'late_checkout', 'due_out', 'departure_overdue',
      'lockout', 'sleep_out', 'payment_concern',
    ]);
    expect(HOUSEKEEPING_CLEANING_TYPES).toEqual([
      'turnover', 'stayover', 'inspection', 'deep_clean', 'custom',
    ]);
  });

  it('normalizes bounded notes without retaining whitespace noise', () => {
    expect(normalizeDailyOperationsText('  inspect   porch  ', 80)).toBe('inspect porch');
    expect(() => normalizeDailyOperationsText('x'.repeat(81), 80)).toThrow('TEXT_TOO_LONG');
  });

  it('normalizes invalid deep-link values to safe defaults', () => {
    expect(parseFrontDeskQuery(new URLSearchParams('queue=bogus&mode=bogus'))).toMatchObject({
      queue: 'arriving', mode: 'compact', selectedId: undefined,
    });
  });
});

describe('daily operations capabilities', () => {
  it('grants only the approved role actions', () => {
    expect(roleCan('front_desk', 'front_desk.flag.write')).toBe(true);
    expect(roleCan('front_desk', 'front_desk.restricted_flag.write')).toBe(false);
    expect(roleCan('housekeeping', 'housekeeping.checklist.update')).toBe(true);
    expect(roleCan('housekeeping', 'housekeeping.verify')).toBe(false);
    expect(roleCan('manager', 'housekeeping.template.manage')).toBe(true);
    expect(roleCan('accounting', 'front_desk.restricted_flag.write')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the red state**

Run: `npx vitest run shared/dailyOperations.test.ts shared/operations.test.ts`

Expected: FAIL because `shared/dailyOperations.ts` and the new capabilities do not exist.

- [ ] **Step 3: Add the complete shared contract**

```ts
// shared/dailyOperations.ts
export const BOOKING_OPERATIONAL_FLAG_KINDS = [
  'late_checkout', 'due_out', 'departure_overdue',
  'lockout', 'sleep_out', 'payment_concern',
] as const;
export type BookingOperationalFlagKind = (typeof BOOKING_OPERATIONAL_FLAG_KINDS)[number];

export const RESTRICTED_FLAG_KINDS = ['lockout', 'payment_concern'] as const;
export type RestrictedFlagKind = (typeof RESTRICTED_FLAG_KINDS)[number];

export const OPERATIONAL_FLAG_SEVERITIES = ['info', 'attention', 'urgent'] as const;
export type OperationalFlagSeverity = (typeof OPERATIONAL_FLAG_SEVERITIES)[number];

export const HOUSEKEEPING_CLEANING_TYPES = [
  'turnover', 'stayover', 'inspection', 'deep_clean', 'custom',
] as const;
export type HousekeepingCleaningType = (typeof HOUSEKEEPING_CLEANING_TYPES)[number];

export const CHECKLIST_ITEM_STATUSES = [
  'pending', 'completed', 'failed', 'not_applicable',
] as const;
export type ChecklistItemStatus = (typeof CHECKLIST_ITEM_STATUSES)[number];

export const FRONT_DESK_QUEUES = [
  'arriving', 'departing', 'stayingOver', 'checkedIn',
  'noShow', 'checkedOut', 'needsAttention',
] as const;
export type FrontDeskQueue = (typeof FRONT_DESK_QUEUES)[number];
export type FrontDeskMode = 'compact' | 'detailed';

export function normalizeDailyOperationsText(value: string, maxLength: number): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length > maxLength) throw new Error('TEXT_TOO_LONG');
  return normalized;
}

export function parseFrontDeskQuery(params: URLSearchParams): {
  queue: FrontDeskQueue;
  mode: FrontDeskMode;
  selectedId?: string;
  query: string;
} {
  const queueValue = params.get('queue');
  const modeValue = params.get('mode');
  return {
    queue: FRONT_DESK_QUEUES.includes(queueValue as FrontDeskQueue)
      ? queueValue as FrontDeskQueue : 'arriving',
    mode: modeValue === 'detailed' ? 'detailed' : 'compact',
    selectedId: params.get('record') || undefined,
    query: (params.get('q') ?? '').slice(0, 120),
  };
}
```

Add these literals to `OPERATIONAL_CAPABILITIES` in `shared/operations.ts`:

```ts
'front_desk.flag.write',
'front_desk.restricted_flag.write',
'housekeeping.template.manage',
'housekeeping.checklist.update',
'housekeeping.verify',
```

Apply the fixed matrix exactly:

```ts
// owner receives ALL_CAPABILITIES.
// manager receives every capability except staff.manage.
// front_desk receives front_desk.flag.write, never restricted_flag.write.
// housekeeping receives housekeeping.checklist.update, never verify/template.manage.
// accounting retains its existing capabilities and receives no new write capability.
```

- [ ] **Step 4: Run the focused tests and typecheck**

Run: `npx vitest run shared/dailyOperations.test.ts shared/operations.test.ts && npm run typecheck`

Expected: both test files PASS and TypeScript exits 0.

- [ ] **Step 5: Commit the shared contract**

```powershell
git add -- shared/dailyOperations.ts shared/dailyOperations.test.ts shared/operations.ts shared/operations.test.ts
git commit -m "feat: define daily operations contracts"
```

## Task 2: Add the additive persistence model

**Files:**
- Modify: `convex/schema.ts`
- Create: `convex/dailyOperationsSchema.test.ts`

- [ ] **Step 1: Write schema compatibility tests before changing the schema**

```ts
// convex/dailyOperationsSchema.test.ts
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import schema from './schema';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');

describe('daily operations schema', () => {
  it('keeps legacy housekeeping assignments valid', async () => {
    const t = convexTest(schema, modules);
    const result = await t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', { email: 'owner@example.test', name: 'Owner' });
      const propertyId = await ctx.db.insert('properties', {
        name: 'Test', slug: 'test', timezone: 'America/Edmonton', currency: 'CAD',
        taxRateBps: 500, email: 'test@example.test', phone: '555', address: '1 Road',
        checkInTime: '16:00', checkOutTime: '11:00', active: true,
      });
      const unitTypeId = await ctx.db.insert('unitTypes', {
        propertyId, name: 'Cabin', slug: 'cabin', kind: 'cabin', bookingMode: 'nightly',
        description: '', photoUrls: [], maxOccupancy: 4, amenities: [], comingSoon: false, sortOrder: 1,
      });
      const unitId = await ctx.db.insert('units', {
        propertyId, unitTypeId, name: 'Cabin 1', slug: 'cabin-1', status: 'active',
        icalExportToken: 'schema', icalImports: [], sortOrder: 1,
      });
      const assignmentId = await ctx.db.insert('housekeepingAssignments', {
        propertyId, unitId, serviceDate: '2030-05-03', priority: 1, status: 'assigned',
        version: 0, createdBy: userId, createdAt: 1, updatedAt: 1,
      });
      return await ctx.db.get(assignmentId);
    });
    expect(result?.cleaningType).toBeUndefined();
  });

  it('stores a property-scoped flag and checklist snapshot', async () => {
    const t = convexTest(schema, modules);
    const counts = await t.run(async (ctx) => ({
      flags: await ctx.db.query('bookingOperationalFlags').collect(),
      templates: await ctx.db.query('housekeepingChecklistTemplates').collect(),
      items: await ctx.db.query('housekeepingChecklistItems').collect(),
    }));
    expect(counts).toEqual({ flags: [], templates: [], items: [] });
  });
});
```

- [ ] **Step 2: Run the schema test and confirm missing tables fail**

Run: `npx vitest run convex/dailyOperationsSchema.test.ts`

Expected: FAIL because the three new table names are absent from the generated data model.

- [ ] **Step 3: Add the schema definitions exactly**

Add optional fields to `housekeepingAssignments`:

```ts
cleaningType: v.optional(v.union(
  v.literal('turnover'), v.literal('stayover'), v.literal('inspection'),
  v.literal('deep_clean'), v.literal('custom'),
)),
customCleaningLabel: v.optional(v.string()),
expectedMinutes: v.optional(v.number()),
checklistTemplateId: v.optional(v.id('housekeepingChecklistTemplates')),
checklistTemplateVersion: v.optional(v.number()),
assignmentNote: v.optional(v.string()),
inspectionResult: v.optional(v.union(v.literal('passed'), v.literal('failed'))),
inspectionNote: v.optional(v.string()),
verifiedBy: v.optional(v.id('users')),
cancelledBy: v.optional(v.id('users')),
sourceCheckoutRequestId: v.optional(v.string()),
```

Add the tables:

```ts
bookingOperationalFlags: defineTable({
  propertyId: v.id('properties'),
  bookingId: v.id('bookings'),
  unitId: v.id('units'),
  kind: v.union(
    v.literal('late_checkout'), v.literal('due_out'),
    v.literal('departure_overdue'), v.literal('lockout'),
    v.literal('sleep_out'), v.literal('payment_concern'),
  ),
  severity: v.union(v.literal('info'), v.literal('attention'), v.literal('urgent')),
  state: v.union(v.literal('open'), v.literal('resolved')),
  summary: v.string(),
  note: v.optional(v.string()),
  dueAt: v.optional(v.number()),
  assignedStaffProfileId: v.optional(v.id('staffProfiles')),
  version: v.number(),
  createdBy: v.id('users'),
  createdAt: v.number(),
  updatedBy: v.id('users'),
  updatedAt: v.number(),
  resolvedBy: v.optional(v.id('users')),
  resolvedAt: v.optional(v.number()),
  resolutionNote: v.optional(v.string()),
})
  .index('by_property_state', ['propertyId', 'state'])
  .index('by_booking_state', ['bookingId', 'state'])
  .index('by_assignee_state', ['assignedStaffProfileId', 'state'])
  .index('by_property_due', ['propertyId', 'dueAt']),

housekeepingChecklistTemplates: defineTable({
  propertyId: v.id('properties'),
  name: v.string(),
  cleaningType: v.union(
    v.literal('turnover'), v.literal('stayover'), v.literal('inspection'),
    v.literal('deep_clean'), v.literal('custom'),
  ),
  active: v.boolean(),
  version: v.number(),
  itemDefinitions: v.array(v.object({
    key: v.string(), label: v.string(), required: v.boolean(), sortOrder: v.number(),
  })),
  createdBy: v.id('users'),
  updatedBy: v.id('users'),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index('by_property_active', ['propertyId', 'active'])
  .index('by_property_type', ['propertyId', 'cleaningType']),

housekeepingChecklistItems: defineTable({
  propertyId: v.id('properties'),
  assignmentId: v.id('housekeepingAssignments'),
  itemKey: v.string(),
  label: v.string(),
  required: v.boolean(),
  sortOrder: v.number(),
  status: v.union(
    v.literal('pending'), v.literal('completed'),
    v.literal('failed'), v.literal('not_applicable'),
  ),
  note: v.optional(v.string()),
  version: v.number(),
  updatedBy: v.id('users'),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
})
  .index('by_assignment_order', ['assignmentId', 'sortOrder'])
  .index('by_property_status', ['propertyId', 'status']),
```

- [ ] **Step 4: Generate types and run schema tests**

Run: `npm run convex:codegen && npx vitest run convex/dailyOperationsSchema.test.ts`

Expected: code generation exits 0 and both schema tests PASS.

- [ ] **Step 5: Commit the schema**

```powershell
git add -- convex/schema.ts convex/dailyOperationsSchema.test.ts convex/_generated
git commit -m "feat: add daily operations schema"
```

## Task 3: Add an idempotent assignment migration with a dry run

**Files:**
- Create: `convex/dailyOperationsMigration.ts`
- Create: `convex/dailyOperationsMigration.test.ts`

- [ ] **Step 1: Write failing migration replay tests**

```ts
// convex/dailyOperationsMigration.test.ts
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');

describe('daily operations assignment migration', () => {
  it('reports defaults without changing rows, then patches each open row once', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert('users', { email: 'owner@example.test', name: 'Owner' });
      const propertyId = await ctx.db.insert('properties', {
        name: 'Test', slug: 'test', timezone: 'America/Edmonton', currency: 'CAD', taxRateBps: 500,
        email: 'test@example.test', phone: '555', address: '1 Road', checkInTime: '16:00', checkOutTime: '11:00', active: true,
      });
      const unitTypeId = await ctx.db.insert('unitTypes', { propertyId, name: 'Cabin', slug: 'cabin', kind: 'cabin', bookingMode: 'nightly', description: '', photoUrls: [], maxOccupancy: 4, amenities: [], comingSoon: false, sortOrder: 1 });
      const unitId = await ctx.db.insert('units', { propertyId, unitTypeId, name: 'Cabin 1', slug: 'cabin-1', status: 'active', icalExportToken: 'migration', icalImports: [], sortOrder: 1 });
      await ctx.db.insert('housekeepingAssignments', { propertyId, unitId, serviceDate: '2030-05-03', priority: 1, status: 'assigned', version: 0, createdBy: userId, createdAt: 1, updatedAt: 1 });
    });
    expect(await t.query(internal.dailyOperationsMigration.preview, { propertySlug: 'test' })).toEqual({ eligible: 1, unchanged: 0 });
    expect(await t.mutation(internal.dailyOperationsMigration.apply, { propertySlug: 'test', cleaningType: 'turnover', expectedMinutes: 45 })).toEqual({ updated: 1, unchanged: 0 });
    expect(await t.mutation(internal.dailyOperationsMigration.apply, { propertySlug: 'test', cleaningType: 'turnover', expectedMinutes: 45 })).toEqual({ updated: 0, unchanged: 1 });
  });
});
```

- [ ] **Step 2: Run the test and confirm the missing module fails**

Run: `npx vitest run convex/dailyOperationsMigration.test.ts`

Expected: FAIL because `dailyOperationsMigration.preview` and `.apply` do not exist.

- [ ] **Step 3: Implement bounded preview and apply functions**

```ts
// convex/dailyOperationsMigration.ts
import { v } from 'convex/values';
import { internalMutation, internalQuery } from './_generated/server';

const cleaningType = v.union(
  v.literal('turnover'), v.literal('stayover'), v.literal('inspection'),
  v.literal('deep_clean'), v.literal('custom'),
);

export const preview = internalQuery({
  args: { propertySlug: v.string() },
  handler: async (ctx, args) => {
    const property = await ctx.db.query('properties').withIndex('by_slug', (q) => q.eq('slug', args.propertySlug)).unique();
    if (!property) throw new Error('PROPERTY_NOT_FOUND');
    const rows = await ctx.db.query('housekeepingAssignments')
      .withIndex('by_property_date', (q) => q.eq('propertyId', property._id)).collect();
    const open = rows.filter((row) => row.status !== 'verified' && row.status !== 'cancelled');
    return {
      eligible: open.filter((row) => row.cleaningType === undefined || row.expectedMinutes === undefined).length,
      unchanged: open.filter((row) => row.cleaningType !== undefined && row.expectedMinutes !== undefined).length,
    };
  },
});

export const apply = internalMutation({
  args: { propertySlug: v.string(), cleaningType, expectedMinutes: v.number() },
  handler: async (ctx, args) => {
    if (!Number.isInteger(args.expectedMinutes) || args.expectedMinutes < 5 || args.expectedMinutes > 480) {
      throw new Error('INVALID_EXPECTED_MINUTES');
    }
    const property = await ctx.db.query('properties').withIndex('by_slug', (q) => q.eq('slug', args.propertySlug)).unique();
    if (!property) throw new Error('PROPERTY_NOT_FOUND');
    const rows = await ctx.db.query('housekeepingAssignments')
      .withIndex('by_property_date', (q) => q.eq('propertyId', property._id)).collect();
    let updated = 0;
    let unchanged = 0;
    for (const row of rows) {
      if (row.status === 'verified' || row.status === 'cancelled') continue;
      if (row.cleaningType !== undefined && row.expectedMinutes !== undefined) { unchanged += 1; continue; }
      await ctx.db.patch(row._id, {
        cleaningType: row.cleaningType ?? args.cleaningType,
        expectedMinutes: row.expectedMinutes ?? args.expectedMinutes,
        version: row.version + 1,
        updatedAt: Date.now(),
      });
      updated += 1;
    }
    return { updated, unchanged };
  },
});
```

- [ ] **Step 4: Run migration and regression tests**

Run: `npx vitest run convex/dailyOperationsMigration.test.ts convex/operationsFoundation.test.ts`

Expected: both test files PASS.

- [ ] **Step 5: Commit the migration**

```powershell
git add -- convex/dailyOperationsMigration.ts convex/dailyOperationsMigration.test.ts
git commit -m "feat: add daily operations migration"
```

## Task 4: Implement operational flags as a separate audited domain

**Files:**
- Create: `convex/operationalFlags.ts`
- Create: `convex/operationalFlags.test.ts`
- Modify: `convex/staff.ts`
- Modify: `convex/staff.test.ts`
- Modify: `src/components/AdminShell.tsx`

- [ ] **Step 1: Write failing authorization, replay, and invariant tests**

```ts
// Add a reusable seed matching convex/frontDesk.test.ts, then cover these exact cases.
it('allows front desk to create an ordinary flag and suppresses a second open flag', async () => {
  const first = await asFrontDesk.mutation(api.operationalFlags.create, {
    propertyId, bookingId, kind: 'late_checkout', severity: 'attention',
    summary: 'Approved until 13:00', expectedBookingVersion: 0, requestId: 'flag-1',
  });
  const duplicate = await asFrontDesk.mutation(api.operationalFlags.create, {
    propertyId, bookingId, kind: 'late_checkout', severity: 'attention',
    summary: 'Approved until 13:00', expectedBookingVersion: 0, requestId: 'flag-2',
  });
  expect(duplicate.flagId).toBe(first.flagId);
  expect(duplicate.existingOpen).toBe(true);
});

it('requires manager authority for lockout and payment concern', async () => {
  await expect(asFrontDesk.mutation(api.operationalFlags.create, {
    propertyId, bookingId, kind: 'lockout', severity: 'urgent', summary: 'Manager review',
    expectedBookingVersion: 0, requestId: 'restricted-1',
  })).rejects.toThrow(/CAPABILITY_DENIED/);
});

it('resolves by expected flag version without changing booking or unit nights', async () => {
  const before = await t.run(async (ctx) => ({ booking: await ctx.db.get(bookingId), nights: await ctx.db.query('unitNights').collect() }));
  const result = await asManager.mutation(api.operationalFlags.resolve, {
    propertyId, flagId, expectedVersion: 0, resolutionNote: 'Reviewed at desk', requestId: 'resolve-1',
  });
  const after = await t.run(async (ctx) => ({ booking: await ctx.db.get(bookingId), nights: await ctx.db.query('unitNights').collect() }));
  expect(result).toMatchObject({ state: 'resolved', version: 1 });
  expect(after).toEqual(before);
});
```

Also test property mismatch before detail disclosure, request-ID reuse, stale versions, assignment to an inactive/cross-property profile, and restricted-flag resolution.

The request-ID reuse assertion must expect `IDEMPOTENCY_KEY_REUSED` when the same property/request pair is presented with a different action.

Add a staff projection test that proves the picker returns only active profiles assigned to the requested property and exposes only `{ staffProfileId, name, role }`.

- [ ] **Step 2: Run the domain test and confirm the red state**

Run: `npx vitest run convex/operationalFlags.test.ts`

Expected: FAIL because the operational flag query and mutations are missing.

- [ ] **Step 3: Implement the public Convex contract**

```ts
// convex/operationalFlags.ts exports these exact functions.
export const listForDate = query({
  args: { propertyId: v.id('properties'), businessDate: v.string() },
  handler: async (ctx, args) => {
    await requirePropertyCapability(ctx, args.propertyId, 'booking.read');
    await requirePropertyFeature(ctx, args.propertyId, 'front_desk_exceptions');
    const rows = await ctx.db.query('bookingOperationalFlags')
      .withIndex('by_property_state', (q) => q.eq('propertyId', args.propertyId).eq('state', 'open')).collect();
    return rows.filter((row) => row.dueAt === undefined || row.dueAt < Date.parse(`${args.businessDate}T23:59:59.999Z`));
  },
});

export const create = mutation({
  args: {
    propertyId: v.id('properties'), bookingId: v.id('bookings'),
    kind: flagKindValidator, severity: flagSeverityValidator,
    summary: v.string(), note: v.optional(v.string()), dueAt: v.optional(v.number()),
    assignedStaffProfileId: v.optional(v.id('staffProfiles')),
    expectedBookingVersion: v.number(), requestId: v.string(), automationToken: v.optional(v.string()),
  },
  handler: createFlagHandler,
});

export const assign = mutation({
  args: {
    propertyId: v.id('properties'), flagId: v.id('bookingOperationalFlags'),
    assignedStaffProfileId: v.optional(v.id('staffProfiles')),
    expectedVersion: v.number(), requestId: v.string(), automationToken: v.optional(v.string()),
  },
  handler: assignFlagHandler,
});

export const resolve = mutation({
  args: {
    propertyId: v.id('properties'), flagId: v.id('bookingOperationalFlags'),
    expectedVersion: v.number(), resolutionNote: v.optional(v.string()),
    requestId: v.string(), automationToken: v.optional(v.string()),
  },
  handler: resolveFlagHandler,
});
```

Inside each handler:

```ts
const capability = RESTRICTED_FLAG_KINDS.includes(kind as RestrictedFlagKind)
  ? 'front_desk.restricted_flag.write' : 'front_desk.flag.write';
const access = await requireMutationPropertyCapability(ctx, propertyId, capability, action, automationToken);
await requirePropertyFeature(ctx, propertyId, 'front_desk_exceptions');
```

Normalize summary to 120 characters, notes to 1,000 characters, and resolution notes to 500 characters with `normalizeDailyOperationsText`. Return safe conflict data as JSON in a `ConvexError` object:

```ts
throw new ConvexError({
  code: 'VERSION_CONFLICT',
  currentVersion: flag.version,
  current: { state: flag.state, severity: flag.severity, assignedStaffProfileId: flag.assignedStaffProfileId },
});
```

Every success inserts one `operationRequests` row and one actor-attributed `auditLog` row. Neither audit detail nor metadata may contain guest contact data, the flag note, or confirmation credentials.

Add this shared assignee picker to `convex/staff.ts`:

```ts
export const propertyAssignees = query({
  args: { propertyId: v.id('properties') },
  handler: async (ctx, args) => {
    await requirePropertyCapability(ctx, args.propertyId, 'property.read');
    const assignments = await ctx.db.query('staffPropertyAssignments')
      .withIndex('by_property', (q) => q.eq('propertyId', args.propertyId)).collect();
    const result = [];
    for (const assignment of assignments.filter((row) => row.active)) {
      const profile = await ctx.db.get(assignment.staffProfileId);
      if (!profile?.active) continue;
      result.push({ staffProfileId: profile._id, name: profile.name, role: assignment.role });
    }
    return result.sort((left, right) => left.name.localeCompare(right.name));
  },
});
```

The migration release sequence runs `staff:backfillPropertyAssignments` before either new subfeature is enabled, so this picker intentionally has no legacy all-property fallback.

Add `timezone: property.timezone` to both branches of `staff.assignedProperties`, include `timezone: string` in `AdminShell.tsx`'s `AssignedProperty`, and assert it in `convex/staff.test.ts`. This lets both pages derive their initial date with `todayIso(property.timezone)` without a second query.

- [ ] **Step 4: Run the domain, capability, and conflict tests**

Run: `npx vitest run convex/operationalFlags.test.ts convex/staff.test.ts shared/operations.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit operational flags**

```powershell
git add -- convex/operationalFlags.ts convex/operationalFlags.test.ts convex/staff.ts convex/staff.test.ts src/components/AdminShell.tsx
git commit -m "feat: add audited front desk flags"
```

## Task 5: Add versioned checklist templates and immutable snapshots

**Files:**
- Create: `convex/housekeepingTemplates.ts`
- Create: `convex/housekeepingTemplates.test.ts`

- [ ] **Step 1: Write failing template and snapshot tests**

```ts
it('creates a normalized property template and snapshots ordered items', async () => {
  const template = await asManager.mutation(api.housekeepingTemplates.save, {
    propertyId, name: 'Turnover standard', cleaningType: 'turnover', active: true,
    items: [
      { key: 'linens', label: 'Replace linens', required: true, sortOrder: 20 },
      { key: 'surfaces', label: 'Sanitize surfaces', required: true, sortOrder: 10 },
    ],
    expectedVersion: 0, requestId: 'template-create',
  });
  const attached = await asManager.mutation(api.housekeepingTemplates.attachToAssignment, {
    propertyId, assignmentId, templateId: template.templateId,
    expectedAssignmentVersion: 0, requestId: 'template-attach',
  });
  expect(attached.items.map((item: { itemKey: string }) => item.itemKey)).toEqual(['surfaces', 'linens']);
});

it('does not rewrite an assignment snapshot after template edits', async () => {
  await asManager.mutation(api.housekeepingTemplates.save, {
    propertyId, templateId, name: 'Turnover standard', cleaningType: 'turnover', active: true,
    items: [{ key: 'new-item', label: 'New instruction', required: true, sortOrder: 10 }],
    expectedVersion: 0, requestId: 'template-edit',
  });
  const items = await t.run(async (ctx) => ctx.db.query('housekeepingChecklistItems')
    .withIndex('by_assignment_order', (q) => q.eq('assignmentId', assignmentId)).collect());
  expect(items.map((item) => item.itemKey)).not.toContain('new-item');
});
```

Also test duplicate item keys, empty labels, more than 100 items, cross-property template attachment, inactive templates, stale template versions, and manager-only management.

- [ ] **Step 2: Run the template tests and confirm missing exports fail**

Run: `npx vitest run convex/housekeepingTemplates.test.ts`

Expected: FAIL because the template query and mutations are absent.

- [ ] **Step 3: Implement the template API and snapshot transaction**

```ts
// convex/housekeepingTemplates.ts exports:
export const list = query({
  args: { propertyId: v.id('properties'), includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    await requirePropertyCapability(ctx, args.propertyId, 'housekeeping.read');
    await requirePropertyFeature(ctx, args.propertyId, 'housekeeping_checklists');
    const rows = await ctx.db.query('housekeepingChecklistTemplates')
      .withIndex('by_property_active', (q) => q.eq('propertyId', args.propertyId)).collect();
    return args.includeInactive ? rows : rows.filter((row) => row.active);
  },
});

export const save = mutation({
  args: {
    propertyId: v.id('properties'), templateId: v.optional(v.id('housekeepingChecklistTemplates')),
    name: v.string(), cleaningType: cleaningTypeValidator, active: v.boolean(),
    items: v.array(v.object({ key: v.string(), label: v.string(), required: v.boolean(), sortOrder: v.number() })),
    expectedVersion: v.number(), requestId: v.string(), automationToken: v.optional(v.string()),
  },
  handler: saveTemplateHandler,
});

export const attachToAssignment = mutation({
  args: {
    propertyId: v.id('properties'), assignmentId: v.id('housekeepingAssignments'),
    templateId: v.id('housekeepingChecklistTemplates'), expectedAssignmentVersion: v.number(),
    requestId: v.string(), automationToken: v.optional(v.string()),
  },
  handler: attachTemplateHandler,
});
```

`attachTemplateHandler` validates property IDs and assignment version first, rejects an existing snapshot, sorts definitions by `sortOrder` then `key`, copies every definition into `housekeepingChecklistItems`, patches the assignment with the template ID/version, and writes idempotency/audit rows in the same mutation.

- [ ] **Step 4: Run focused tests**

Run: `npx vitest run convex/housekeepingTemplates.test.ts convex/dailyOperationsSchema.test.ts`

Expected: all tests PASS.

- [ ] **Step 5: Commit templates**

```powershell
git add -- convex/housekeepingTemplates.ts convex/housekeepingTemplates.test.ts
git commit -m "feat: add housekeeping checklist templates"
```

## Task 6: Complete the assignment, checklist, and inspection lifecycle

**Files:**
- Create: `convex/housekeepingWork.ts`
- Create: `convex/housekeepingWork.test.ts`
- Modify: `convex/housekeeping.ts`
- Modify: `convex/housekeeping.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

```ts
it('updates an assigned checklist and advances readiness atomically', async () => {
  await asHousekeeper.mutation(api.housekeepingWork.start, {
    propertyId, assignmentId, expectedAssignmentVersion: 0, requestId: 'start-1',
  });
  await asHousekeeper.mutation(api.housekeepingWork.updateChecklistItem, {
    propertyId, assignmentId, itemId: requiredItemId, status: 'completed',
    expectedItemVersion: 0, expectedAssignmentVersion: 1, requestId: 'item-1',
  });
  const submitted = await asHousekeeper.mutation(api.housekeepingWork.submitForInspection, {
    propertyId, assignmentId, expectedAssignmentVersion: 2, requestId: 'submit-1',
  });
  expect(submitted).toMatchObject({ assignmentStatus: 'ready_for_inspection', serviceState: 'inspection' });
});

it('rejects submission with a required item still pending without partial writes', async () => {
  const before = await readAssignmentState(t, assignmentId, unitId);
  await expect(asHousekeeper.mutation(api.housekeepingWork.submitForInspection, {
    propertyId, assignmentId, expectedAssignmentVersion: before.assignment.version,
    requestId: 'submit-incomplete',
  })).rejects.toThrow(/REQUIRED_CHECKLIST_INCOMPLETE/);
  expect(await readAssignmentState(t, assignmentId, unitId)).toEqual(before);
});

it('fails inspection back to cleaning and verifies only with manager authority', async () => {
  const failed = await asManager.mutation(api.housekeepingWork.reviewInspection, {
    propertyId, assignmentId, outcome: 'failed', note: 'Mirror needs correction',
    expectedAssignmentVersion: 3, requestId: 'inspect-fail',
  });
  expect(failed).toMatchObject({ assignmentStatus: 'in_progress', serviceState: 'cleaning' });
  await expect(asHousekeeper.mutation(api.housekeepingWork.reviewInspection, {
    propertyId, assignmentId, outcome: 'passed', expectedAssignmentVersion: 4,
    requestId: 'inspect-pass-denied',
  })).rejects.toThrow(/CAPABILITY_DENIED/);
});
```

Also test reassignment, cancellation before verification, manager-only required-item override with reason, assignment ownership, actual duration, replay, cross-property IDs, stale item/assignment/service versions, and no change to unit sellability or `unitNights`.

- [ ] **Step 2: Run lifecycle tests and confirm the red state**

Run: `npx vitest run convex/housekeepingWork.test.ts convex/housekeeping.test.ts`

Expected: FAIL because the work mutations and additive board fields are absent.

- [ ] **Step 3: Implement the focused work module**

```ts
// convex/housekeepingWork.ts public surface
export const listAssignments = query({
  args: { propertyId: v.id('properties'), serviceDate: v.string() },
  handler: listAssignmentsHandler,
});
export const audit = query({
  args: {
    propertyId: v.id('properties'), from: v.string(), to: v.string(),
    unitId: v.optional(v.id('units')), assignedStaffProfileId: v.optional(v.id('staffProfiles')),
    cleaningType: v.optional(cleaningTypeValidator), inspectionResult: v.optional(inspectionResultValidator),
  },
  handler: auditHandler,
});
export const updateAssignment = mutation({
  args: {
    propertyId: v.id('properties'), assignmentId: v.id('housekeepingAssignments'),
    assignedStaffProfileId: v.optional(v.id('staffProfiles')), priority: v.number(),
    cleaningType: cleaningTypeValidator, customCleaningLabel: v.optional(v.string()),
    expectedMinutes: v.number(), assignmentNote: v.optional(v.string()),
    expectedVersion: v.number(), requestId: v.string(), automationToken: v.optional(v.string()),
  },
  handler: updateAssignmentHandler,
});
export const start = mutation({ args: startArgs, handler: startHandler });
export const updateChecklistItem = mutation({ args: checklistItemArgs, handler: updateChecklistItemHandler });
export const submitForInspection = mutation({ args: submitArgs, handler: submitForInspectionHandler });
export const reviewInspection = mutation({ args: reviewArgs, handler: reviewInspectionHandler });
export const cancel = mutation({ args: cancelArgs, handler: cancelHandler });
```

Use one mutation for every assignment/checklist/service-state transition. Check all expected versions before the first write. A housekeeper may mutate only when `assignedStaffProfileId === access.profile._id`; manager/owner bypass that ownership check. `not_applicable` on a required item requires `housekeeping.verify` plus a non-empty note. A passed inspection sets assignment `verified` and service state `ready`; a failed inspection sets `in_progress` and `cleaning`.

Modify `housekeeping.board` to return these additive fields while retaining every existing field:

```ts
unitTypeId: unit.unitTypeId,
unitTypeName: unitType?.name ?? 'Unknown type',
unitGroups: groupMemberships.map(({ unitGroupId, name }) => ({ unitGroupId, name })),
cleaningType: assignment?.cleaningType,
expectedMinutes: assignment?.expectedMinutes,
assignmentVersion: assignment?.version,
checklist: { completed, total, requiredRemaining },
lastCleanedAt,
```

Read group membership through `unitGroupMembers.by_unit`, validate every group belongs to the same property, and return names only for active groups. When `housekeeping_checklists` is absent, do not query checklist rows; return `checklist: { completed: 0, total: 0, requiredRemaining: 0 }` and keep the existing board usable.

Modify `housekeeping.assign` to accept optional `cleaningType`, `customCleaningLabel`, `expectedMinutes`, `assignmentNote`, and `expectedVersion`. Preserve the old call shape, use defaults only for newly created rows, and reject stale edits when `expectedVersion` is supplied.

- [ ] **Step 4: Run lifecycle and legacy regression tests**

Run: `npx vitest run convex/housekeepingWork.test.ts convex/housekeeping.test.ts convex/operationsWorkflows.test.ts`

Expected: all tests PASS, including the old `housekeeping.assign` contract.

- [ ] **Step 5: Commit the housekeeping domain**

```powershell
git add -- convex/housekeepingWork.ts convex/housekeepingWork.test.ts convex/housekeeping.ts convex/housekeeping.test.ts
git commit -m "feat: complete housekeeping work lifecycle"
```

## Task 7: Enrich front-desk queues and create turnover work on checkout

**Files:**
- Modify: `convex/frontDesk.ts`
- Modify: `convex/frontDesk.test.ts`

- [ ] **Step 1: Add failing queue and checkout-handoff tests**

```ts
it('returns open flags, service progress, and a needs-attention queue', async () => {
  await createOpenFlag(t, { propertyId, bookingId, unitId, kind: 'departure_overdue', severity: 'urgent' });
  const queues = await asOwner.query(api.frontDesk.queues, { propertyId, businessDate: '2030-05-03' });
  expect(queues.needsAttention[0]).toMatchObject({ bookingId });
  expect(queues.needsAttention[0].openFlags[0]).toMatchObject({ kind: 'departure_overdue', severity: 'urgent' });
  expect(queues.needsAttention[0]).toHaveProperty('housekeepingProgress');
});

it('records late checkout and sleep-out without changing stay dates or inventory', async () => {
  const before = await readBookingAndNights(t, bookingId);
  await createOpenFlag(t, { propertyId, bookingId, unitId, kind: 'late_checkout', severity: 'attention', dueAt: Date.parse('2030-05-03T19:00:00Z') });
  await createOpenFlag(t, { propertyId, bookingId, unitId, kind: 'sleep_out', severity: 'info' });
  expect(await readBookingAndNights(t, bookingId)).toEqual(before);
});

it('creates one turnover assignment when checklist handoff is enabled', async () => {
  await enableFeature(t, propertyId, 'housekeeping_checklists');
  await asOwner.mutation(api.frontDesk.transition, { propertyId, bookingId, transition: 'check_in', expectedVersion: 0, requestId: 'checkin' });
  await asOwner.mutation(api.frontDesk.transition, { propertyId, bookingId, transition: 'check_out', expectedVersion: 1, requestId: 'checkout' });
  await asOwner.mutation(api.frontDesk.transition, { propertyId, bookingId, transition: 'check_out', expectedVersion: 1, requestId: 'checkout' });
  const assignments = await t.run(async (ctx) => ctx.db.query('housekeepingAssignments')
    .withIndex('by_unit_date', (q) => q.eq('unitId', unitId).eq('serviceDate', '2030-05-03')).collect());
  expect(assignments).toHaveLength(1);
  expect(assignments[0]).toMatchObject({ cleaningType: 'turnover', sourceCheckoutRequestId: 'checkout' });
});
```

- [ ] **Step 2: Run front-desk tests and confirm the red state**

Run: `npx vitest run convex/frontDesk.test.ts`

Expected: FAIL because `needsAttention`, flag projections, service progress, and turnover creation are absent.

- [ ] **Step 3: Build the enriched read model and atomic handoff**

For each relevant booking, read only open property-matching flags, the dated assignment, and its checklist counts. Return safe projections:

```ts
openFlags: flags.map(({ _id, kind, severity, summary, dueAt, assignedStaffProfileId, version }) => ({
  flagId: _id, kind, severity, summary, dueAt, assignedStaffProfileId, version,
})),
housekeepingProgress: assignment ? {
  assignmentId: assignment._id,
  status: assignment.status,
  completed: checklist.filter((item) => item.status === 'completed').length,
  total: checklist.length,
} : undefined,
expectedDepartureAt: lateCheckout?.dueAt,
policySummary: {
  standardCheckInTime: property.checkInTime,
  standardCheckOutTime: property.checkOutTime,
},
recentEvents: recentAuditRows
  .filter((event) => event.entityType === 'booking' && event.entityId === booking._id)
  .slice(0, 5)
  .map(({ actorName, action, detail, ts }) => ({ actorName, action, detail, ts })),
```

Derive `needsAttention` from open `departure_overdue`, `lockout`, or `payment_concern` flags and from positive balances on due-out records. Do not infer payment settlement from browser or flag state.

Check whether `front_desk_exceptions` is enabled before querying flags or exposing flag fields. With the subfeature absent, return `openFlags: []`, no `needsAttention` rows caused by flags, and preserve every existing front-desk queue field. Bound recent property audit reads to the newest 200 rows before filtering by booking.

Within the existing checkout mutation, after marking the service state dirty, check the `housekeeping_checklists` feature row. When enabled, find the unique `by_unit_date` assignment for the booking checkout date and create or refresh one open turnover assignment with `sourceCheckoutRequestId: args.requestId`. Never replace a verified assignment. Because the booking transition, assignment handoff, idempotency row, and audit event share one Convex mutation, any failure rolls the transaction back.

- [ ] **Step 4: Run front-desk, conflict, channel, and housekeeping tests**

Run: `npx vitest run convex/frontDesk.test.ts convex/housekeepingWork.test.ts convex/bookingConflict.test.ts convex/channel/ari.test.ts`

Expected: all tests PASS; checkout still releases only its own `unitNights` and dirty-marks channel availability.

- [ ] **Step 5: Commit the front-desk read model and handoff**

```powershell
git add -- convex/frontDesk.ts convex/frontDesk.test.ts
git commit -m "feat: connect front desk and housekeeping"
```

## Task 8: Add URL-backed front-desk state and the record drawer

**Files:**
- Create: `src/lib/frontDeskViewState.ts`
- Create: `src/lib/frontDeskViewState.test.ts`
- Create: `src/components/front-desk/FrontDeskToolbar.tsx`
- Create: `src/components/front-desk/FrontDeskQueue.tsx`
- Create: `src/components/front-desk/FrontDeskRecordDrawer.tsx`
- Modify: `src/pages/AdminFrontDeskPage.tsx`

- [ ] **Step 1: Write failing URL-state and filtering tests**

```ts
// src/lib/frontDeskViewState.test.ts
import { describe, expect, it } from 'vitest';
import { filterFrontDeskRows, parseFrontDeskViewState, serializeFrontDeskViewState } from './frontDeskViewState';

describe('front desk view state', () => {
  it('round-trips the selected date, queue, mode, filters, and record', () => {
    const state = parseFrontDeskViewState(new URLSearchParams(
      'date=2030-05-03&queue=needsAttention&mode=detailed&q=cabin&flag=lockout&readiness=dirty&balance=open&record=b1',
    ));
    expect(serializeFrontDeskViewState(state).toString()).toBe(
      'date=2030-05-03&queue=needsAttention&mode=detailed&q=cabin&flag=lockout&readiness=dirty&balance=open&record=b1',
    );
  });

  it('filters without changing the server-owned queue membership', () => {
    expect(filterFrontDeskRows([
      { bookingId: 'b1', guestName: 'Sample Guest', confirmationCode: 'A1', unitName: 'Cabin 1', readiness: 'dirty', balanceCents: 100, openFlags: [{ kind: 'lockout', severity: 'urgent' }] },
      { bookingId: 'b2', guestName: 'Other Guest', confirmationCode: 'A2', unitName: 'Cabin 2', readiness: 'ready', balanceCents: 0, openFlags: [] },
    ], { query: 'cabin 1', flag: 'lockout', readiness: 'dirty', balance: 'open' })).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the state test and confirm the missing module fails**

Run: `npx vitest run src/lib/frontDeskViewState.test.ts`

Expected: FAIL because the view-state module is missing.

- [ ] **Step 3: Implement pure URL and filtering helpers**

```ts
// src/lib/frontDeskViewState.ts
import { FRONT_DESK_QUEUES, type FrontDeskMode, type FrontDeskQueue } from '../../shared/dailyOperations';
import { isIsoDate, todayIso } from './dates';

export type FrontDeskViewState = {
  date: string; queue: FrontDeskQueue; mode: FrontDeskMode; query: string;
  flag?: string; readiness?: string; balance?: 'open' | 'settled'; assignee?: string; record?: string;
};

export function parseFrontDeskViewState(params: URLSearchParams, timezone?: string): FrontDeskViewState {
  const queue = params.get('queue');
  const date = params.get('date');
  return {
    date: date && isIsoDate(date) ? date : todayIso(timezone),
    queue: FRONT_DESK_QUEUES.includes(queue as FrontDeskQueue) ? queue as FrontDeskQueue : 'arriving',
    mode: params.get('mode') === 'detailed' ? 'detailed' : 'compact',
    query: (params.get('q') ?? '').slice(0, 120),
    flag: params.get('flag') || undefined,
    readiness: params.get('readiness') || undefined,
    balance: params.get('balance') === 'open' ? 'open' : params.get('balance') === 'settled' ? 'settled' : undefined,
    assignee: params.get('assignee') || undefined,
    record: params.get('record') || undefined,
  };
}

export function serializeFrontDeskViewState(state: FrontDeskViewState): URLSearchParams {
  const params = new URLSearchParams();
  params.set('date', state.date); params.set('queue', state.queue); params.set('mode', state.mode);
  if (state.query) params.set('q', state.query);
  if (state.flag) params.set('flag', state.flag);
  if (state.readiness) params.set('readiness', state.readiness);
  if (state.balance) params.set('balance', state.balance);
  if (state.assignee) params.set('assignee', state.assignee);
  if (state.record) params.set('record', state.record);
  return params;
}
```

Implement `filterFrontDeskRows` as a pure, case-insensitive conjunction over query, flag, readiness, balance, and assignee. It must not move rows between server-provided queues.

- [ ] **Step 4: Build focused components and page orchestration**

`FrontDeskToolbar.tsx` owns previous/today/next buttons, search, filter controls, compact/detailed switch, print, and export callbacks. `FrontDeskQueue.tsx` renders semantic buttons for records and badges. `FrontDeskRecordDrawer.tsx` receives the selected safe row plus capability booleans and exposes:

```ts
type FrontDeskRecordDrawerProps = {
  row: QueueRow;
  canWriteFlags: boolean;
  canWriteRestrictedFlags: boolean;
  onTransition(action: 'check_in' | 'check_out' | 'no_show'): Promise<void>;
  onCreateFlag(input: CreateFlagInput): Promise<void>;
  onAssignFlag(flagId: string, version: number, assignee?: string): Promise<void>;
  onResolveFlag(flagId: string, version: number, resolutionNote?: string): Promise<void>;
  onClose(): void;
};
```

Refactor `AdminFrontDeskPage.tsx` to use `useSearchParams`, property timezone, `api.frontDesk.queues`, and `api.operationalFlags` mutations. Preserve the selected record on a version conflict, update the URL on every state change, and announce success/conflict through one `role="status"` region. Link to booking, folio, unit, and housekeeping assignment using existing authenticated routes; omit a link when the target route has no record identifier.

- [ ] **Step 5: Run UI unit tests and typecheck**

Run: `npx vitest run src/lib/frontDeskViewState.test.ts && npm run typecheck`

Expected: tests PASS and TypeScript exits 0.

- [ ] **Step 6: Commit the front-desk interface**

```powershell
git add -- src/lib/frontDeskViewState.ts src/lib/frontDeskViewState.test.ts src/components/front-desk src/pages/AdminFrontDeskPage.tsx
git commit -m "feat: build front desk operations workspace"
```

## Task 9: Add Board, Assignments, Checklist, and Audit housekeeping views

**Files:**
- Create: `src/lib/housekeepingViewState.ts`
- Create: `src/lib/housekeepingViewState.test.ts`
- Create: `src/components/housekeeping/HousekeepingToolbar.tsx`
- Create: `src/components/housekeeping/HousekeepingBoard.tsx`
- Create: `src/components/housekeeping/HousekeepingAssignments.tsx`
- Create: `src/components/housekeeping/HousekeepingChecklist.tsx`
- Create: `src/components/housekeeping/HousekeepingAudit.tsx`
- Modify: `src/pages/AdminHousekeepingPage.tsx`

- [ ] **Step 1: Write failing view-state tests**

```ts
// src/lib/housekeepingViewState.test.ts
import { describe, expect, it } from 'vitest';
import { parseHousekeepingViewState, serializeHousekeepingViewState } from './housekeepingViewState';

describe('housekeeping view state', () => {
  it('round-trips board, assignment, and audit filters', () => {
    const state = parseHousekeepingViewState(new URLSearchParams(
      'date=2030-05-03&view=audit&state=inspection&assignee=s1&cleaning=turnover&priority=2&result=failed&record=a1',
    ));
    expect(serializeHousekeepingViewState(state).toString()).toBe(
      'date=2030-05-03&view=audit&state=inspection&assignee=s1&cleaning=turnover&priority=2&result=failed&record=a1',
    );
  });

  it('uses safe defaults for malformed values', () => {
    expect(parseHousekeepingViewState(new URLSearchParams('view=unknown&priority=-9'))).toMatchObject({ view: 'board', priority: undefined });
  });
});
```

- [ ] **Step 2: Run the view-state tests and confirm the red state**

Run: `npx vitest run src/lib/housekeepingViewState.test.ts`

Expected: FAIL because the view-state module is absent.

- [ ] **Step 3: Implement the pure state contract**

```ts
// src/lib/housekeepingViewState.ts
import { isIsoDate, todayIso } from './dates';
export type HousekeepingView = 'board' | 'assignments' | 'audit';
export type HousekeepingViewState = {
  date: string; view: HousekeepingView; state?: string; unitGroup?: string;
  unitType?: string; assignee?: string; cleaning?: string; priority?: number;
  result?: 'passed' | 'failed'; record?: string;
};

export function parseHousekeepingViewState(params: URLSearchParams, timezone?: string): HousekeepingViewState {
  const date = params.get('date');
  const view = params.get('view');
  const priority = Number(params.get('priority'));
  return {
    date: date && isIsoDate(date) ? date : todayIso(timezone),
    view: view === 'assignments' || view === 'audit' ? view : 'board',
    state: params.get('state') || undefined,
    unitGroup: params.get('group') || undefined,
    unitType: params.get('type') || undefined,
    assignee: params.get('assignee') || undefined,
    cleaning: params.get('cleaning') || undefined,
    priority: Number.isInteger(priority) && priority >= 0 ? priority : undefined,
    result: params.get('result') === 'passed' ? 'passed' : params.get('result') === 'failed' ? 'failed' : undefined,
    record: params.get('record') || undefined,
  };
}
```

`serializeHousekeepingViewState` writes parameters in the test order and omits empty values.

- [ ] **Step 4: Build the three views and page orchestration**

Use the following component boundaries:

```ts
HousekeepingToolbar({ state, counts, canAssign, onChange, onPrint, onExport })
HousekeepingBoard({ units, selectedId, onSelect })
HousekeepingAssignments({ assignments, selectedId, canAssign, onSelect, onCreate })
HousekeepingChecklist({ assignment, items, capabilities, onStart, onItemChange, onSubmit, onReview, onCancel })
HousekeepingAudit({ records, filters })
```

`AdminHousekeepingPage.tsx` reads `api.housekeeping.board`, `api.housekeepingWork.listAssignments`, `api.housekeepingWork.audit`, and `api.housekeepingTemplates.list` only when their associated view and feature flag require them. It keeps one selected assignment in the URL, one `role="status"` region, and one conflict handler that refreshes without closing the checklist. Print and CSV operate on the currently filtered rows. Mobile renders cards and action sheets; the desktop board may use columns but must not create page-level horizontal overflow.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npx vitest run src/lib/housekeepingViewState.test.ts && npm run typecheck`

Expected: tests PASS and TypeScript exits 0.

- [ ] **Step 6: Commit the housekeeping interface**

```powershell
git add -- src/lib/housekeepingViewState.ts src/lib/housekeepingViewState.test.ts src/components/housekeeping src/pages/AdminHousekeepingPage.tsx
git commit -m "feat: build housekeeping operations workspace"
```

## Task 10: Expose the same workflows through API, CLI, and MCP

**Files:**
- Modify: `convex/apiV1.ts`
- Modify: `convex/apiV1.test.ts`
- Modify: `cli/src/client.ts`
- Modify: `cli/src/client.test.ts`
- Modify: `cli/src/index.test.ts`
- Modify: `cli/src/mcp.ts`
- Modify: `cli/src/mcp.test.ts`

- [ ] **Step 1: Write failing HTTP action and privacy tests**

```ts
it('routes flag and checklist actions through single-use automation claims', async () => {
  const createFlag = await request('/api/v1/operations/front-desk/flag/create', {
    method: 'POST', key: writeKey,
    json: { property: 'test', requestId: 'api-flag-1', bookingId, kind: 'late_checkout', severity: 'attention', summary: 'Approved', expectedBookingVersion: 0 },
  });
  expect(createFlag.status).toBe(200);
  const item = await request('/api/v1/operations/housekeeping/checklist/item', {
    method: 'POST', key: writeKey,
    json: { property: 'test', requestId: 'api-item-1', assignmentId, itemId, status: 'completed', expectedItemVersion: 0, expectedAssignmentVersion: 0 },
  });
  expect(item.status).toBe(200);
});

it('keeps housekeeping reads free of guest contacts and confirmation credentials', async () => {
  const response = await request('/api/v1/operations/housekeeping?property=test&date=2030-05-03', { key: readKey });
  const body = JSON.stringify(await response.json());
  expect(body).not.toMatch(/guest@example|confirmationCode|bolt11|paymentHash/i);
});
```

- [ ] **Step 2: Run API tests and confirm unknown actions fail**

Run: `npx vitest run convex/apiV1.test.ts`

Expected: FAIL with `Unknown operations action` for the new routes.

- [ ] **Step 3: Register the exact claim-backed actions**

Add these definitions to the existing operation map in `convex/apiV1.ts`:

```ts
'front-desk/flag/create': { action: 'front_desk.flag.create', mutation: api.operationalFlags.create },
'front-desk/flag/assign': { action: 'front_desk.flag.assign', mutation: api.operationalFlags.assign },
'front-desk/flag/resolve': { action: 'front_desk.flag.resolve', mutation: api.operationalFlags.resolve },
'housekeeping/assignment/update': { action: 'housekeeping.assignment.update', mutation: api.housekeepingWork.updateAssignment },
'housekeeping/assignment/start': { action: 'housekeeping.assignment.start', mutation: api.housekeepingWork.start },
'housekeeping/checklist/item': { action: 'housekeeping.checklist.item', mutation: api.housekeepingWork.updateChecklistItem },
'housekeeping/inspection/submit': { action: 'housekeeping.inspection.submit', mutation: api.housekeepingWork.submitForInspection },
'housekeeping/inspection/review': { action: 'housekeeping.inspection.review', mutation: api.housekeepingWork.reviewInspection },
'housekeeping/assignment/cancel': { action: 'housekeeping.assignment.cancel', mutation: api.housekeepingWork.cancel },
```

Map only `front-desk/transition` dynamically. Every new action uses the exact static action string above so the issued claim matches what the mutation consumes. Replace the inline front-desk and housekeeping read duplication with property-bounded safe projection helpers exported as internal queries from the domain modules, capped at 200 records.

When the caller omits `date`, derive the business date in the property timezone rather than UTC:

```ts
const businessDate = args.businessDate ?? new Intl.DateTimeFormat('en-CA', {
  timeZone: property.timezone,
  year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
```

Add a fake-timer API regression at a UTC/property-local date boundary, matching the property-local closeout convention.

- [ ] **Step 4: Extend client literals and parity tests**

Add the same nine path literals to `OperationalActionName` in `cli/src/client.ts`. Keep `ops-action` generic. Add one client URL assertion, one `dispatch` assertion, and one MCP tool assertion:

```ts
await client.operationsAction('front-desk/flag/resolve', {
  property: 'kokanee', requestId: 'req-flag', flagId: 'f1', expectedVersion: 0,
});
expect(fetchImpl.mock.calls[0][0]).toBe(
  'https://example.convex.site/api/v1/operations/front-desk/flag/resolve',
);
```

Update the MCP action description to name operational flags, assignments, checklists, and inspections. Do not add bypass tools or direct Convex mutation access.

- [ ] **Step 5: Run API, CLI, and MCP tests**

Run:

```powershell
npx vitest run convex/apiV1.test.ts
npm --prefix cli test -- client.test.ts index.test.ts mcp.test.ts
npm --prefix cli run typecheck
```

Expected: root API tests PASS; CLI client, dispatch, and MCP tests PASS; CLI typecheck exits 0.

- [ ] **Step 6: Commit automation parity**

```powershell
git add -- convex/apiV1.ts convex/apiV1.test.ts cli/src/client.ts cli/src/client.test.ts cli/src/index.test.ts cli/src/mcp.ts cli/src/mcp.test.ts
git commit -m "feat: expose daily operations automation"
```

## Task 11: Add fictional public-tour examples without live data

**Files:**
- Modify: `src/fixtures/publicOperationsFixture.ts`
- Modify: `tests/publicOperationsTour.test.ts`

- [ ] **Step 1: Write failing fixture coverage and privacy assertions**

```ts
it('shows the accepted daily operations examples', () => {
  const titles = PUBLIC_OPERATIONS_FIXTURE.records.map((record) => record.title);
  expect(titles).toEqual(expect.arrayContaining([
    'Late checkout notice',
    'Departure overdue',
    'Turnover checklist',
    'Inspection correction',
    'Verified ready unit',
  ]));
});

it('keeps fictional daily operations free of live identifiers and mutation hooks', () => {
  const body = JSON.stringify(PUBLIC_OPERATIONS_FIXTURE);
  expect(body).not.toMatch(/@|confirmation.?code|unitId|bookingId|paymentHash|bolt11|wallet/i);
  const page = fs.readFileSync('src/pages/PublicOperationsTourPage.tsx', 'utf8');
  expect(page).not.toContain("from 'convex/react'");
  expect(page).not.toContain('useMutation');
});
```

- [ ] **Step 2: Run the public-tour test and confirm missing examples fail**

Run: `npx vitest run tests/publicOperationsTour.test.ts`

Expected: FAIL because the five new fictional record titles are absent.

- [ ] **Step 3: Add five local fixture records**

Add records with kinds `front_desk` or `housekeeping`, fictional labels, relative update labels, and details that explain:

```ts
{
  id: 'demo-front-desk-late-checkout',
  kind: 'front_desk',
  title: 'Late checkout notice',
  status: 'Open · attention',
  summary: 'A fictional departure remains on today’s desk list with a later expected time.',
  updatedLabel: '8 min ago',
  details: [
    { label: 'Booking status', value: 'Checked in · unchanged' },
    { label: 'Inventory', value: 'Stay dates remain authoritative' },
    { label: 'Action', value: 'Desk follow-up assigned' },
  ],
}
```

Follow the same shape for `Departure overdue`, `Turnover checklist`, `Inspection correction`, and `Verified ready unit`. Use no guest names, contacts, confirmation codes, stay dates, unit identifiers, payment identifiers, or wallet fields.

- [ ] **Step 4: Run all public-boundary tests**

Run: `npx vitest run tests/publicOperationsTour.test.ts tests/cloudflarePagesShowcase.test.ts`

Expected: both files PASS.

- [ ] **Step 5: Commit the fictional tour additions**

```powershell
git add -- src/fixtures/publicOperationsFixture.ts tests/publicOperationsTour.test.ts
git commit -m "feat: expand fictional operations tour"
```

## Task 12: Verify accessibility, responsive behavior, exports, and conflicts

**Files:**
- Create: `tests/dailyOperationsAccessibility.test.ts`
- Modify: `playwright.config.ts` only if the existing projects do not include a 390px viewport

- [ ] **Step 1: Add source-contract accessibility tests**

```ts
// tests/dailyOperationsAccessibility.test.ts
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('daily operations interface contracts', () => {
  const frontDesk = fs.readFileSync('src/pages/AdminFrontDeskPage.tsx', 'utf8');
  const housekeeping = fs.readFileSync('src/pages/AdminHousekeepingPage.tsx', 'utf8');
  const drawer = fs.readFileSync('src/components/front-desk/FrontDeskRecordDrawer.tsx', 'utf8');
  const checklist = fs.readFileSync('src/components/housekeeping/HousekeepingChecklist.tsx', 'utf8');

  it('announces results and preserves selected records during conflicts', () => {
    expect(frontDesk).toContain('role="status"');
    expect(housekeeping).toContain('role="status"');
    expect(frontDesk).toContain('VERSION_CONFLICT');
    expect(housekeeping).toContain('VERSION_CONFLICT');
  });

  it('uses semantic dialogs and labelled controls', () => {
    expect(drawer).toContain('role="dialog"');
    expect(drawer).toContain('aria-modal="true"');
    expect(checklist).toContain('fieldset');
    expect(checklist).toContain('legend');
  });

  it('offers print and CSV actions from both workspaces', () => {
    expect(frontDesk).toContain('window.print()');
    expect(frontDesk).toContain('text/csv');
    expect(housekeeping).toContain('window.print()');
    expect(housekeeping).toContain('text/csv');
  });
});
```

- [ ] **Step 2: Run the interface contracts and correct any failures**

Run: `npx vitest run tests/dailyOperationsAccessibility.test.ts src/lib/frontDeskViewState.test.ts src/lib/housekeepingViewState.test.ts`

Expected: all tests PASS.

- [ ] **Step 3: Run authenticated browser acceptance locally**

Start Convex and Vite in separate terminals with staff routes included and both subfeatures enabled only on a disposable property:

```powershell
$env:VITE_PUBLIC_STAFF='true'
npm run convex:dev
npm run dev -- --host 127.0.0.1
```

Exercise this exact sequence at desktop and 390px width:

1. Open `/admin/front-desk?queue=arriving&mode=compact`.
2. Search, filter, switch detailed mode, select a record, and reload the deep link.
3. Create and resolve an ordinary flag; verify restricted flag controls are absent for front desk.
4. Check out a disposable booking; observe one dirty turnover assignment reactively.
5. Open `/admin/housekeeping?view=assignments`, assign/start work, complete required items, and submit for inspection.
6. Fail inspection once, correct the item, resubmit, and pass inspection.
7. Confirm unit readiness becomes ready while booking, folio, sellability, and `unitNights` remain untouched beyond the authorized checkout.
8. Print and export the currently filtered front-desk list and housekeeping audit.
9. Confirm keyboard focus remains visible, dialogs return focus to their opener, semantic announcements occur, and neither viewport has page-level horizontal overflow.

Expected: the sequence completes without console errors, stale drawer closure, duplicate assignments, or hidden controls becoming actionable.

- [ ] **Step 4: Commit acceptance protections**

```powershell
git add -- tests/dailyOperationsAccessibility.test.ts playwright.config.ts
git commit -m "test: cover daily operations accessibility"
```

## Task 13: Document rollout, automation, migration, and rollback

**Files:**
- Modify: `docs/command-center.md`
- Modify: `docs/automation.md`
- Modify: `docs/configuration.md`
- Modify: `STATUS.md`

- [ ] **Step 1: Update the command-center authority documentation**

Add a `Daily operations` section to `docs/command-center.md` stating:

```md
Operational flags never change booking status, stay dates, payment state, or inventory.
Housekeeping assignments and checklist history never change sellability. Checkout may create one
turnover assignment when `housekeeping_checklists` is enabled; only the existing maintenance block
workflow removes inventory. Passing inspection changes readiness to `ready` and nothing else.
```

- [ ] **Step 2: Document flags and safe rollout commands**

Add to `docs/configuration.md`:

```md
| `front_desk_exceptions` | Operational flags, attention filters, and flag mutations |
| `housekeeping_checklists` | Templates, snapshots, checklist work, inspections, and checkout handoff |
```

Document dry-run and apply commands using exact property IDs only:

```powershell
npx convex run dailyOperationsMigration:preview '{"propertySlug":"test"}'
npx convex run dailyOperationsMigration:apply '{"propertySlug":"test","cleaningType":"turnover","expectedMinutes":45}'
```

State that the operator must inspect the preview, run apply twice, and confirm the second run reports zero updates before enabling `housekeeping_checklists`.

- [ ] **Step 3: Document API, CLI, and MCP examples**

Add to `docs/automation.md` one read and one write example:

```powershell
openstays ops housekeeping --property kokanee --date 2030-05-03
$frontDesk = openstays ops front-desk --property kokanee --date 2030-05-03 | ConvertFrom-Json
$flagId = ($frontDesk.records.openFlags | Select-Object -First 1).flagId
$inputJson = @{ flagId = $flagId; expectedVersion = 0; resolutionNote = 'Reviewed at desk' } | ConvertTo-Json -Compress
openstays ops-action front-desk/flag/resolve --property kokanee --request-id req-flag-001 --input-json $inputJson
```

Explain that the write-scoped key inherits its owner’s active property role, receives a single-use claim, and calls the same mutation as the browser.

- [ ] **Step 4: Update status without claiming deployment**

In `STATUS.md`, record the branch, date, implemented local capability, test counts after the final gate, and both subfeatures as disabled-by-default. Do not claim live enablement, production migration, push, merge, or deployment unless those actions have actually occurred.

- [ ] **Step 5: Build documentation and commit**

Run: `npm run docs:build`

Expected: VitePress exits 0 with no broken-link or build error.

```powershell
git add -- docs/command-center.md docs/automation.md docs/configuration.md STATUS.md
git commit -m "docs: add daily operations runbook"
```

## Task 14: Run the full release gate and prepare a reviewable branch

**Files:**
- Modify only files required to fix failures discovered by these gates.

- [ ] **Step 1: Run root verification**

```powershell
npm test
npm run typecheck
npm run build
npm run docs:build
npm run audit:runtime
```

Expected: all root tests PASS; typecheck, production build, docs build, and runtime audit exit 0.

- [ ] **Step 2: Run CLI verification**

```powershell
npm --prefix cli test
npm --prefix cli run typecheck
npm --prefix cli run build
```

Expected: all CLI tests PASS and both compile gates exit 0.

- [ ] **Step 3: Run Cloudflare operations verification**

```powershell
npm --prefix ops/cloudflare test
npm --prefix ops/cloudflare run typecheck
npm --prefix ops/cloudflare run build
npx --prefix ops/cloudflare wrangler deploy --config ops/cloudflare/wrangler.synology.jsonc --dry-run
```

Expected: operations tests, typecheck, build, and dry-run packaging exit 0. No deployment occurs.

- [ ] **Step 4: Run the full browser smoke gate**

Run: `npm run test:e2e:smoke`

Expected: Playwright smoke tests PASS with the version-matched Wavelength runtime present.

- [ ] **Step 5: Inspect the exact branch delta**

```powershell
git diff --check main...HEAD
git status --short
git log --oneline main..HEAD
git diff --stat main...HEAD
```

Expected: no whitespace errors, a clean worktree, small task-scoped commits, and no credential, customer-data, ResNexus-source, generated-wallet, or unrelated workspace changes.

- [ ] **Step 6: Stop at the local release boundary**

Report the branch name, commit list, exact test counts, build results, browser acceptance result, existing dependency-audit findings, and the two disabled subfeatures. A merge, push, schema deployment, migration execution, or production flag change requires the user’s explicit instruction at that later boundary.
