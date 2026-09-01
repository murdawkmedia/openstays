/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');
const identityFor = (userId: Id<'users'>) => ({ subject: `${userId}|test-session` });
const workApi = (api as any).housekeepingWork;

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const propertyId = await ctx.db.insert('properties', {
      name: 'Test Resort', slug: 'test', timezone: 'America/Edmonton', currency: 'CAD',
      taxRateBps: 500, email: 'test@example.test', phone: '555', address: '1 Road',
      checkInTime: '16:00', checkOutTime: '11:00', active: true,
    });
    const staff = [];
    for (const [email, name, role] of [
      ['owner@example.test', 'Owner', 'owner'],
      ['manager@example.test', 'Manager', 'manager'],
      ['housekeeper@example.test', 'Housekeeper', 'housekeeping'],
      ['second@example.test', 'Second Housekeeper', 'housekeeping'],
    ] as const) {
      const userId = await ctx.db.insert('users', { email, name });
      const profileId = await ctx.db.insert('staffProfiles', {
        userId, name, role: role === 'owner' ? 'owner' : 'staff', active: true, createdAt: 1,
      });
      await ctx.db.insert('staffPropertyAssignments', {
        staffProfileId: profileId, userId, propertyId, role, active: true, createdAt: 1, updatedAt: 1,
      });
      staff.push({ userId, profileId });
    }
    for (const feature of ['housekeeping', 'housekeeping_checklists']) {
      await ctx.db.insert('propertyFeatures', {
        propertyId, feature, enabled: true, version: 1, updatedBy: staff[0].userId, updatedAt: 1,
      });
    }
    const unitTypeId = await ctx.db.insert('unitTypes', {
      propertyId, name: 'Cabin', slug: 'cabin', kind: 'cabin', bookingMode: 'nightly',
      description: '', photoUrls: [], maxOccupancy: 4, amenities: [], comingSoon: false, sortOrder: 1,
    });
    const unitId = await ctx.db.insert('units', {
      propertyId, unitTypeId, name: 'Cabin 1', slug: 'cabin-1', status: 'active',
      icalExportToken: 'work', icalImports: [], sortOrder: 1,
    });
    const serviceStateId = await ctx.db.insert('unitServiceStates', {
      propertyId, unitId, state: 'dirty', version: 0, updatedBy: staff[0].userId, updatedAt: 1,
    });
    const assignmentId = await ctx.db.insert('housekeepingAssignments', {
      propertyId, unitId, serviceDate: '2030-05-03', assignedStaffProfileId: staff[2].profileId,
      priority: 1, status: 'assigned', cleaningType: 'turnover', expectedMinutes: 45,
      version: 0, createdBy: staff[0].userId, createdAt: 1, updatedAt: 1,
    });
    const requiredItemId = await ctx.db.insert('housekeepingChecklistItems', {
      propertyId, assignmentId, itemKey: 'linens', label: 'Replace linens', required: true,
      sortOrder: 10, status: 'pending', version: 0, updatedBy: staff[0].userId, updatedAt: 1,
    });
    const optionalItemId = await ctx.db.insert('housekeepingChecklistItems', {
      propertyId, assignmentId, itemKey: 'porch', label: 'Sweep porch', required: false,
      sortOrder: 20, status: 'pending', version: 0, updatedBy: staff[0].userId, updatedAt: 1,
    });
    return {
      propertyId, unitId, serviceStateId, assignmentId, requiredItemId, optionalItemId,
      owner: staff[0], manager: staff[1], housekeeper: staff[2], secondHousekeeper: staff[3],
    };
  });
}

async function readState(
  t: ReturnType<typeof convexTest>,
  assignmentId: Id<'housekeepingAssignments'>,
  unitId: Id<'units'>,
) {
  return await t.run(async (ctx) => ({
    assignment: await ctx.db.get(assignmentId),
    // Generated Convex types are intentionally not refreshed without a configured
    // deployment in this isolated worktree; convex-test still validates the live schema.
    service: await (ctx.db as any).query('unitServiceStates').withIndex('by_unit', (q: any) => q.eq('unitId', unitId)).unique(),
    items: await (ctx.db as any).query('housekeepingChecklistItems')
      .withIndex('by_assignment_order', (q: any) => q.eq('assignmentId', assignmentId)).collect(),
  }));
}

describe('housekeeping work lifecycle', () => {
  it('updates an assigned checklist and advances readiness atomically', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const asHousekeeper = t.withIdentity(identityFor(f.housekeeper.userId));
    await asHousekeeper.mutation(workApi.start, {
      propertyId: f.propertyId, assignmentId: f.assignmentId,
      expectedAssignmentVersion: 0, expectedServiceVersion: 0, requestId: 'start-1',
    });
    await asHousekeeper.mutation(workApi.updateChecklistItem, {
      propertyId: f.propertyId, assignmentId: f.assignmentId, itemId: f.requiredItemId,
      status: 'completed', expectedItemVersion: 0, expectedAssignmentVersion: 1, requestId: 'item-1',
    });
    const submitted = await asHousekeeper.mutation(workApi.submitForInspection, {
      propertyId: f.propertyId, assignmentId: f.assignmentId,
      expectedAssignmentVersion: 2, expectedServiceVersion: 1, requestId: 'submit-1',
    });
    expect(submitted).toMatchObject({
      assignmentStatus: 'ready_for_inspection', serviceState: 'inspection',
    });
    expect(await readState(t, f.assignmentId, f.unitId)).toMatchObject({
      assignment: { status: 'ready_for_inspection', version: 3 },
      service: { state: 'inspection', version: 2 },
    });
  });

  it('rejects an incomplete required checklist without partial writes', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const asHousekeeper = t.withIdentity(identityFor(f.housekeeper.userId));
    await asHousekeeper.mutation(workApi.start, {
      propertyId: f.propertyId, assignmentId: f.assignmentId,
      expectedAssignmentVersion: 0, expectedServiceVersion: 0, requestId: 'start-1',
    });
    const before = await readState(t, f.assignmentId, f.unitId);
    await expect(asHousekeeper.mutation(workApi.submitForInspection, {
      propertyId: f.propertyId, assignmentId: f.assignmentId,
      expectedAssignmentVersion: 1, expectedServiceVersion: 1, requestId: 'submit-incomplete',
    })).rejects.toThrow(/REQUIRED_CHECKLIST_INCOMPLETE/);
    expect(await readState(t, f.assignmentId, f.unitId)).toEqual(before);
  });

  it('fails inspection back to cleaning and restricts verification to managers', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const asHousekeeper = t.withIdentity(identityFor(f.housekeeper.userId));
    await asHousekeeper.mutation(workApi.start, {
      propertyId: f.propertyId, assignmentId: f.assignmentId,
      expectedAssignmentVersion: 0, expectedServiceVersion: 0, requestId: 'start-1',
    });
    await asHousekeeper.mutation(workApi.updateChecklistItem, {
      propertyId: f.propertyId, assignmentId: f.assignmentId, itemId: f.requiredItemId,
      status: 'completed', expectedItemVersion: 0, expectedAssignmentVersion: 1, requestId: 'item-1',
    });
    await asHousekeeper.mutation(workApi.submitForInspection, {
      propertyId: f.propertyId, assignmentId: f.assignmentId,
      expectedAssignmentVersion: 2, expectedServiceVersion: 1, requestId: 'submit-1',
    });
    await expect(asHousekeeper.mutation(workApi.reviewInspection, {
      propertyId: f.propertyId, assignmentId: f.assignmentId, outcome: 'passed',
      expectedAssignmentVersion: 3, expectedServiceVersion: 2, requestId: 'review-denied',
    })).rejects.toThrow(/CAPABILITY_DENIED/);
    const failed = await t.withIdentity(identityFor(f.manager.userId)).mutation(workApi.reviewInspection, {
      propertyId: f.propertyId, assignmentId: f.assignmentId, outcome: 'failed',
      note: 'Mirror needs correction', expectedAssignmentVersion: 3,
      expectedServiceVersion: 2, requestId: 'review-failed',
    });
    expect(failed).toMatchObject({ assignmentStatus: 'in_progress', serviceState: 'cleaning' });
  });

  it('enforces assignment ownership and manager-only required-item overrides', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await expect(t.withIdentity(identityFor(f.secondHousekeeper.userId)).mutation(workApi.start, {
      propertyId: f.propertyId, assignmentId: f.assignmentId,
      expectedAssignmentVersion: 0, expectedServiceVersion: 0, requestId: 'wrong-owner',
    })).rejects.toThrow(/ASSIGNMENT_NOT_OWNED/);
    await expect(t.withIdentity(identityFor(f.housekeeper.userId)).mutation(workApi.updateChecklistItem, {
      propertyId: f.propertyId, assignmentId: f.assignmentId, itemId: f.requiredItemId,
      status: 'not_applicable', note: 'Not needed', expectedItemVersion: 0,
      expectedAssignmentVersion: 0, requestId: 'override-denied',
    })).rejects.toThrow(/CAPABILITY_DENIED/);
    await expect(t.withIdentity(identityFor(f.manager.userId)).mutation(workApi.updateChecklistItem, {
      propertyId: f.propertyId, assignmentId: f.assignmentId, itemId: f.requiredItemId,
      status: 'not_applicable', expectedItemVersion: 0,
      expectedAssignmentVersion: 0, requestId: 'override-no-reason',
    })).rejects.toThrow(/OVERRIDE_REASON_REQUIRED/);
  });
});
