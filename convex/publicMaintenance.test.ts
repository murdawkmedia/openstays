import { convexTest } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';

import { internal } from './_generated/api';
import schema from './schema';
import { PII_RETENTION_MS } from './publicMaintenance';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');

describe('public payment retention', () => {
  it('purges old PII while preserving paid and immutable records', async () => {
    const now = Date.UTC(2026, 6, 26, 12);
    vi.spyOn(Date, 'now').mockReturnValue(now);
    const old = now - PII_RETENTION_MS - 1;
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const propertyId = await ctx.db.insert('properties', {
        name: 'Consensus Commons', slug: 'consensus-commons',
        timezone: 'America/Toronto', currency: 'CAD', taxRateBps: 0,
        taxLabel: 'Tax', email: 'staff@example.com', phone: '555',
        address: 'Fictional', checkInTime: '16:00', checkOutTime: '11:00',
        active: true,
      });
      const unitTypeId = await ctx.db.insert('unitTypes', {
        propertyId, name: 'Node Room', slug: 'node-room', kind: 'room',
        bookingMode: 'nightly', description: '', photoUrls: [],
        maxOccupancy: 2, amenities: [], comingSoon: false, sortOrder: 1,
      });
      const unitId = await ctx.db.insert('units', {
        propertyId, unitTypeId, name: 'Node 1', slug: 'node-1',
        status: 'active', icalExportToken: 'retention-token-123456',
        icalImports: [], sortOrder: 1,
      });
      const guestId = await ctx.db.insert('guests', {
        propertyId, name: 'Private Guest', email: 'private@example.com',
        phone: '555-0100', normalizedEmail: 'private@example.com',
        normalizedPhone: '5550100', marketingOptIn: false,
        notes: [{ ts: old, text: 'private note', by: 'guest' }],
      });
      const bookingId = await ctx.db.insert('bookings', {
        propertyId, unitId, unitTypeId, guestId,
        checkIn: '2026-07-01', checkOut: '2026-07-02', nights: 1,
        adults: 1, children: 0, status: 'confirmed', source: 'online',
        confirmationCode: 'OS-OLDPAID', statusHistory: [{ status: 'confirmed', ts: old }],
        notes: [], createdAt: old, updatedAt: old,
        publicPaymentConsent: {
          version: 'openstays.public-live.v1', acceptedAt: old, rail: 'zaprite',
        },
      });
      const paymentId = await ctx.db.insert('payments', {
        propertyId, bookingId, provider: 'zaprite',
        providerCheckoutId: 'order-old', amountCents: 100, gstCents: 0,
        currency: 'CAD', status: 'paid', refunds: [],
        createdAt: old, paidAt: old, consentVersion: 'openstays.public-live.v1',
      });
      const receiptId = await ctx.db.insert('consensusReceipts', {
        propertyId, bookingId, publicId: 'receipt-old',
        schemaVersion: 'openstays.consensus-receipt.v1',
        canonicalJson: '{"old":true}', sha256: 'a'.repeat(64),
        status: 'submitted', createdAt: old, updatedAt: old, submittedAt: old,
      });
      const messageId = await ctx.db.insert('bookingMessages', {
        propertyId, bookingId, authorRole: 'guest',
        authorName: 'Private Guest', text: 'private message', createdAt: old,
      });
      const emailId = await ctx.db.insert('emailLog', {
        propertyId, bookingId, to: 'private@example.com', from: 'staff@example.com',
        templateKey: 'confirmation', subject: 'Private subject',
        html: '<p>Private</p>', text: 'Private body', provider: 'mail_bridge',
        idempotencyKey: 'booking:old:confirmation', status: 'sent',
        providerMessageId: 'provider-message', ts: old,
      });
      return { guestId, bookingId, paymentId, receiptId, messageId, emailId };
    });

    await t.mutation((internal as any).publicMaintenance.runNightly, {});
    await t.mutation((internal as any).publicMaintenance.runNightly, {});

    const state = await t.run(async (ctx) => ({
      guest: await ctx.db.get(ids.guestId),
      booking: await ctx.db.get(ids.bookingId),
      payment: await ctx.db.get(ids.paymentId),
      receipt: await ctx.db.get(ids.receiptId),
      message: await ctx.db.get(ids.messageId),
      email: await ctx.db.get(ids.emailId),
    }));
    expect(state.guest).toMatchObject({
      name: 'Purged guest',
      email: '',
      phone: '',
      normalizedEmail: `purged:${ids.guestId}`,
      normalizedPhone: `purged:${ids.guestId}`,
      notes: [],
    });
    expect(state.booking).not.toBeNull();
    expect(state.payment).toMatchObject({
      provider: 'zaprite', amountCents: 100, status: 'paid',
    });
    expect(state.receipt?.canonicalJson).toBe('{"old":true}');
    expect(state.message).toBeNull();
    expect(state.email).toMatchObject({
      to: '', subject: '', retentionPurgedAt: now,
    });
    expect(state.email?.html).toBeUndefined();
    expect(state.email?.text).toBeUndefined();
  });
});
