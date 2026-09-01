/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';

import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');
const identityFor = (userId: Id<'users'>) => ({ subject: `${userId}|test-session` });
const templatesApi = (api as any).housekeepingTemplates;

async function seed(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const propertyId = await ctx.db.insert('properties', {
      name: 'Test Resort', slug: 'test', timezone: 'America/Edmonton', currency: 'CAD',
      taxRateBps: 500, email: 'test@example.test', phone: '555', address: '1 Road',
      checkInTime: '16:00', checkOutTime: '11:00', active: true,
    });
    const otherPropertyId = await ctx.db.insert('properties', {
      name: 'Other', slug: 'other', timezone: 'America/Edmonton', currency: 'CAD',
      taxRateBps: 500, email: 'other@example.test', phone: '555', address: '2 Road',
      checkInTime: '16:00', checkOutTime: '11:00', active: true,
    });
    const staff = [];
    for (const [email, name, role] of [
      ['owner@example.test', 'Owner', 'owner'],
      ['manager@example.test', 'Manager', 'manager'],
      ['housekeeper@example.test', 'Housekeeper', 'housekeeping'],
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
      icalExportToken: 'template', icalImports: [], sortOrder: 1,
    });
    const assignmentId = await ctx.db.insert('housekeepingAssignments', {
      propertyId, unitId, serviceDate: '2030-05-03', priority: 1, status: 'assigned',
      version: 0, createdBy: staff[0].userId, createdAt: 1, updatedAt: 1,
    });
    return {
      propertyId, otherPropertyId, assignmentId,
      owner: staff[0], manager: staff[1], housekeeper: staff[2],
    };
  });
}

const items = [
  { key: 'linens', label: 'Replace linens', required: true, sortOrder: 20 },
  { key: 'surfaces', label: 'Sanitize surfaces', required: true, sortOrder: 10 },
];

describe('housekeeping checklist templates', () => {
  it('creates a normalized template and snapshots ordered items', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const asManager = t.withIdentity(identityFor(f.manager.userId));
    const template = await asManager.mutation(templatesApi.save, {
      propertyId: f.propertyId, name: '  Turnover   standard ', cleaningType: 'turnover',
      active: true, items, expectedVersion: 0, requestId: 'template-create',
    });
    const attached = await asManager.mutation(templatesApi.attachToAssignment, {
      propertyId: f.propertyId, assignmentId: f.assignmentId, templateId: template.templateId,
      expectedAssignmentVersion: 0, requestId: 'template-attach',
    });
    expect(attached.items.map((item: { itemKey: string }) => item.itemKey))
      .toEqual(['surfaces', 'linens']);
    const stored = await t.run(async (ctx) =>
      ctx.db.get(template.templateId as Id<'housekeepingChecklistTemplates'>),
    );
    expect(stored?.name).toBe('Turnover standard');
  });

  it('does not rewrite an assignment snapshot after template edits', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const asManager = t.withIdentity(identityFor(f.manager.userId));
    const template = await asManager.mutation(templatesApi.save, {
      propertyId: f.propertyId, name: 'Turnover standard', cleaningType: 'turnover',
      active: true, items, expectedVersion: 0, requestId: 'template-create',
    });
    await asManager.mutation(templatesApi.attachToAssignment, {
      propertyId: f.propertyId, assignmentId: f.assignmentId, templateId: template.templateId,
      expectedAssignmentVersion: 0, requestId: 'template-attach',
    });
    await asManager.mutation(templatesApi.save, {
      propertyId: f.propertyId, templateId: template.templateId,
      name: 'Turnover standard', cleaningType: 'turnover', active: true,
      items: [{ key: 'new-item', label: 'New instruction', required: true, sortOrder: 10 }],
      expectedVersion: 0, requestId: 'template-edit',
    });
    const storedItems = await t.run(async (ctx) => ctx.db
      .query('housekeepingChecklistItems')
      .withIndex('by_assignment_order', (q) => q.eq('assignmentId', f.assignmentId))
      .collect());
    expect(storedItems.map((item) => item.itemKey)).toEqual(['surfaces', 'linens']);
  });

  it('rejects duplicate keys and non-manager template management', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    await expect(t.withIdentity(identityFor(f.manager.userId)).mutation(templatesApi.save, {
      propertyId: f.propertyId, name: 'Bad template', cleaningType: 'turnover', active: true,
      items: [items[0], { ...items[0], label: 'Duplicate' }],
      expectedVersion: 0, requestId: 'template-bad',
    })).rejects.toThrow(/DUPLICATE_CHECKLIST_KEY/);
    await expect(t.withIdentity(identityFor(f.housekeeper.userId)).mutation(templatesApi.save, {
      propertyId: f.propertyId, name: 'Denied', cleaningType: 'turnover', active: true,
      items, expectedVersion: 0, requestId: 'template-denied',
    })).rejects.toThrow(/CAPABILITY_DENIED/);
  });

  it('rejects cross-property and repeated assignment snapshots', async () => {
    const t = convexTest(schema, modules);
    const f = await seed(t);
    const asManager = t.withIdentity(identityFor(f.manager.userId));
    const template = await asManager.mutation(templatesApi.save, {
      propertyId: f.propertyId, name: 'Turnover', cleaningType: 'turnover', active: true,
      items, expectedVersion: 0, requestId: 'template-create',
    });
    await expect(asManager.mutation(templatesApi.attachToAssignment, {
      propertyId: f.otherPropertyId, assignmentId: f.assignmentId, templateId: template.templateId,
      expectedAssignmentVersion: 0, requestId: 'cross-property',
    })).rejects.toThrow(/PROPERTY_ACCESS_DENIED|PROPERTY_RECORD_MISMATCH/);
    await asManager.mutation(templatesApi.attachToAssignment, {
      propertyId: f.propertyId, assignmentId: f.assignmentId, templateId: template.templateId,
      expectedAssignmentVersion: 0, requestId: 'attach-1',
    });
    await expect(asManager.mutation(templatesApi.attachToAssignment, {
      propertyId: f.propertyId, assignmentId: f.assignmentId, templateId: template.templateId,
      expectedAssignmentVersion: 1, requestId: 'attach-2',
    })).rejects.toThrow(/CHECKLIST_ALREADY_ATTACHED/);
  });
});
