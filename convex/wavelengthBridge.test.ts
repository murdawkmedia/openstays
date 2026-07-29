/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { bridgeBearerAuthorized } from './wavelength';
import {
  eligibilityEmailDigest,
  PUBLIC_CONSENT_VERSION,
  signEligibilityToken,
} from './publicPolicy';
import schema from './schema';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');

describe('bridgeBearerAuthorized', () => {
  it('accepts only the exact bearer token', () => {
    expect(bridgeBearerAuthorized('Bearer bridge-secret', 'bridge-secret')).toBe(true);
    expect(bridgeBearerAuthorized('Bearer forged', 'bridge-secret')).toBe(false);
    expect(bridgeBearerAuthorized('bridge-secret', 'bridge-secret')).toBe(false);
    expect(bridgeBearerAuthorized(undefined, 'bridge-secret')).toBe(false);
    expect(bridgeBearerAuthorized('Bearer bridge-secret', '')).toBe(false);
  });

  it('requires fresh health and creates an exact public 1,000-sat request', async () => {
    const signingKey = 'test-only-signing-key-with-at-least-32-bytes';
    vi.stubEnv('PUBLIC_LIVE_PAYMENTS', 'true');
    vi.stubEnv('WAVELENGTH_ENABLED', 'true');
    vi.stubEnv('WAVELENGTH_NETWORK', 'signet');
    vi.stubEnv('WAVELENGTH_BRIDGE_TOKEN', 'bridge-secret');
    vi.stubEnv('ELIGIBILITY_HMAC_SECRET', signingKey);
    const t = convexTest(schema, modules);
    const now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const propertyId = await ctx.db.insert('properties', { name: 'Consensus Commons', slug: 'consensus-commons',
        timezone: 'America/Toronto', currency: 'CAD', taxRateBps: 0, taxLabel: 'HST', email: 'staff@example.test',
        phone: '', address: 'Toronto', checkInTime: '16:00', checkOutTime: '11:00', active: true });
      const unitTypeId = await ctx.db.insert('unitTypes', { propertyId, name: 'Node', slug: 'node', kind: 'room', bookingMode: 'nightly',
        description: '', photoUrls: [], maxOccupancy: 2, amenities: [], comingSoon: false, sortOrder: 1 });
      const unitId = await ctx.db.insert('units', { propertyId, unitTypeId, name: 'Node 1', slug: 'node-1', status: 'active',
        icalExportToken: 'test', icalImports: [], sortOrder: 1 });
      const guestId = await ctx.db.insert('guests', { propertyId, name: 'Guest', email: 'guest@example.test',
        normalizedEmail: 'guest@example.test', phone: '', normalizedPhone: '', marketingOptIn: false, notes: [] });
      const bookingId = await ctx.db.insert('bookings', { propertyId, unitTypeId, unitId, guestId,
        checkIn: '2026-08-16', checkOut: '2026-08-17', nights: 1, adults: 1, children: 0,
        status: 'hold', source: 'direct', confirmationCode: 'OS-PUBLIC-WAVE', holdExpiresAt: now + 600_000,
        priceBreakdown: { nightlySubtotalCents: 50_000, addOnSubtotalCents: 0, promoDiscountCents: 0,
          taxableSubtotalCents: 50_000, gstCents: 0, totalCents: 50_000, giftCertAppliedCents: 0,
          depositDueCents: 50_000, balanceDueCents: 0 },
        statusHistory: [{ status: 'hold', ts: now }], notes: [], createdAt: now, updatedAt: now });
      return { bookingId };
    });

    await expect(t.query((api as any).wavelength.available, {}))
      .resolves.toMatchObject({ available: false, network: 'signet' });
    await expect(t.mutation((api as any).wavelength.createRequest, {
      bookingId: seeded.bookingId, confirmationCode: 'OS-PUBLIC-WAVE',
      email: 'guest@example.test',
      consent: { version: PUBLIC_CONSENT_VERSION, accepted: true },
    })).rejects.toThrow('WAVELENGTH_UNAVAILABLE');

    await t.run(async (ctx) => {
      await ctx.db.insert('bridgeHealth', {
        service: 'wavelength', status: 'ready', release: 'test',
        lastHeartbeatAt: now, spendableSats: 20_000,
        createdAt: now, updatedAt: now,
      });
    });
    await expect(t.mutation((api as any).wavelength.createRequest, {
      bookingId: seeded.bookingId, confirmationCode: 'OS-PUBLIC-WAVE',
      email: 'guest@example.test',
      consent: { version: PUBLIC_CONSENT_VERSION, accepted: true },
    })).rejects.toThrow('WAVELENGTH_ELIGIBILITY_REQUIRED');
    const eligibilityToken = await signEligibilityToken({
      v: 1, jti: 'public-wave-1', action: 'wavelength_payment',
      bookingId: String(seeded.bookingId),
      emailDigest: await eligibilityEmailDigest('guest@example.test', signingKey),
      deviceDigest: 'device-digest', networkDigest: 'network-digest',
      iat: now, exp: now + 300_000,
    }, signingKey);
    const request = await t.mutation((api as any).wavelength.createRequest, {
      bookingId: seeded.bookingId, confirmationCode: 'OS-PUBLIC-WAVE',
      email: 'guest@example.test',
      consent: { version: PUBLIC_CONSENT_VERSION, accepted: true },
      eligibilityToken,
    });
    expect(request).toMatchObject({ satsAmount: 1_000, quotedAmountCents: 50_000, network: 'signet' });
    const resumedRequest = await t.mutation((api as any).wavelength.createRequest, {
      bookingId: seeded.bookingId, confirmationCode: 'OS-PUBLIC-WAVE',
      email: 'guest@example.test',
      consent: { version: PUBLIC_CONSENT_VERSION, accepted: true },
    });
    expect(resumedRequest?._id).toBe(request?._id);
    const booking = await t.run((ctx) => ctx.db.get(seeded.bookingId));
    expect(booking?.publicPaymentConsent).toMatchObject({
      version: PUBLIC_CONSENT_VERSION,
      rail: 'wavelength',
    });
  });

  it('drops cancelled or expired work before claiming the next payable request', async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const propertyId = await ctx.db.insert('properties', { name: 'Consensus Commons', slug: 'consensus-commons',
        timezone: 'America/Toronto', currency: 'CAD', taxRateBps: 0, taxLabel: 'HST', email: 'staff@example.test',
        phone: '', address: 'Toronto', checkInTime: '16:00', checkOutTime: '11:00', active: true });
      const unitTypeId = await ctx.db.insert('unitTypes', { propertyId, name: 'Node', slug: 'node', kind: 'room', bookingMode: 'nightly',
        description: '', photoUrls: [], maxOccupancy: 2, amenities: [], comingSoon: false, sortOrder: 1 });
      const unitId = await ctx.db.insert('units', { propertyId, unitTypeId, name: 'Node 1', slug: 'node-1', status: 'active',
        icalExportToken: 'test', icalImports: [], sortOrder: 1 });
      const now = Date.now();
      const cancelledBookingId = await ctx.db.insert('bookings', { propertyId, unitTypeId, unitId, checkIn: '2026-08-15', checkOut: '2026-08-16',
        nights: 1, adults: 1, children: 0, status: 'cancelled', source: 'demo', confirmationCode: 'OS-CANCELLED',
        statusHistory: [{ status: 'hold', ts: now - 1_000 }, { status: 'cancelled', ts: now }], notes: [], createdAt: now, updatedAt: now });
      const payableBookingId = await ctx.db.insert('bookings', { propertyId, unitTypeId, unitId, checkIn: '2026-08-16', checkOut: '2026-08-17',
        nights: 1, adults: 1, children: 0, status: 'hold', source: 'demo', confirmationCode: 'OS-PAYABLE', holdExpiresAt: now + 600_000,
        statusHistory: [{ status: 'hold', ts: now }], notes: [], createdAt: now, updatedAt: now });
      const cancelledPaymentId = await ctx.db.insert('payments', { propertyId, bookingId: cancelledBookingId, provider: 'wavelength', amountCents: 21,
        gstCents: 0, currency: 'CAD', status: 'pending', refunds: [], createdAt: now });
      const payablePaymentId = await ctx.db.insert('payments', { propertyId, bookingId: payableBookingId, provider: 'wavelength', amountCents: 21,
        gstCents: 0, currency: 'CAD', status: 'pending', refunds: [], createdAt: now });
      const cancelledRequestId = await ctx.db.insert('wavelengthRequests', { propertyId, bookingId: cancelledBookingId, paymentId: cancelledPaymentId,
        quotedAmountCents: 21, currency: 'CAD', network: 'signet', satsAmount: 210, expiresAt: now + 600_000, status: 'claimed', createdAt: now - 1_000,
        updatedAt: now, claimedAt: now });
      const payableRequestId = await ctx.db.insert('wavelengthRequests', { propertyId, bookingId: payableBookingId, paymentId: payablePaymentId,
        quotedAmountCents: 21, currency: 'CAD', network: 'signet', satsAmount: 1_000, expiresAt: now + 600_000, status: 'requested', createdAt: now,
        updatedAt: now });
      return { cancelledRequestId, cancelledPaymentId, payableRequestId };
    });

    const claimed = await t.mutation((internal as any).wavelength.claimPending, { limit: 10 });
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ _id: ids.payableRequestId, status: 'claimed', satsAmount: 1_000 });
    const cancelled = await t.run((ctx) => ctx.db.get(ids.cancelledRequestId));
    expect(cancelled).toMatchObject({ status: 'failed', failureReason: 'BOOKING_NOT_PAYABLE' });
    expect(await t.run((ctx) => ctx.db.get(ids.cancelledPaymentId))).toMatchObject({ status: 'failed' });
  });

  it('retires an exact terminal merchant receive and its pending payment idempotently', async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const propertyId = await ctx.db.insert('properties', { name: 'Consensus Commons', slug: 'consensus-commons',
        timezone: 'America/Toronto', currency: 'CAD', taxRateBps: 0, taxLabel: 'HST', email: 'staff@example.test',
        phone: '', address: 'Toronto', checkInTime: '16:00', checkOutTime: '11:00', active: true });
      const unitTypeId = await ctx.db.insert('unitTypes', { propertyId, name: 'Node', slug: 'node', kind: 'room', bookingMode: 'nightly',
        description: '', photoUrls: [], maxOccupancy: 2, amenities: [], comingSoon: false, sortOrder: 1 });
      const unitId = await ctx.db.insert('units', { propertyId, unitTypeId, name: 'Node 1', slug: 'node-1', status: 'active',
        icalExportToken: 'test', icalImports: [], sortOrder: 1 });
      const now = Date.now();
      const bookingId = await ctx.db.insert('bookings', { propertyId, unitTypeId, unitId, checkIn: '2026-08-20', checkOut: '2026-08-21',
        nights: 1, adults: 1, children: 0, status: 'hold', source: 'demo', confirmationCode: 'OS-RETRY',
        holdExpiresAt: now + 600_000, statusHistory: [{ status: 'hold', ts: now }], notes: [], createdAt: now, updatedAt: now });
      const paymentId = await ctx.db.insert('payments', { propertyId, bookingId, provider: 'wavelength', amountCents: 21,
        gstCents: 0, currency: 'CAD', status: 'pending', refunds: [], createdAt: now });
      const requestId = await ctx.db.insert('wavelengthRequests', { propertyId, bookingId, paymentId,
        quotedAmountCents: 21, currency: 'CAD', network: 'signet', satsAmount: 1_000, expiresAt: now + 600_000,
        bolt11: 'lntbs10u1retry', bridgeActivityId: 'receive_retry', status: 'invoice_ready',
        createdAt: now, updatedAt: now, claimedAt: now });
      return { requestId, paymentId };
    });

    const prepared = await t.mutation((internal as any).wavelength.prepareSettlement, {
      requestId: ids.requestId, network: 'signet', bolt11: 'lntbs10u1retry',
      bridgeActivityId: 'receive_retry', satsAmount: 1_000, paymentHash: 'late_settlement_hash',
    });
    expect(prepared.duplicate).toBe(false);

    const first = await t.mutation((internal as any).wavelength.markFailed, {
      requestId: ids.requestId, network: 'signet', bolt11: 'lntbs10u1retry',
      bridgeActivityId: 'receive_retry', satsAmount: 1_000, terminalStatus: 'failed',
      reason: 'receive intent already used',
    });
    expect(first).toEqual({ failed: true, duplicate: false });
    expect(await t.run((ctx) => ctx.db.get(ids.requestId))).toMatchObject({
      status: 'failed', failureReason: 'receive intent already used',
    });
    expect(await t.run((ctx) => ctx.db.get(ids.paymentId))).toMatchObject({ status: 'failed' });

    await expect(t.mutation((internal as any).wavelength.markFailed, {
      requestId: ids.requestId, network: 'signet', bolt11: 'forged',
      bridgeActivityId: 'receive_retry', satsAmount: 1_000, terminalStatus: 'failed', reason: 'forged',
    })).rejects.toThrow('WAVELENGTH_FAILURE_MISMATCH');

    await expect(t.mutation((internal as any).wavelength.markFailed, {
      requestId: ids.requestId, network: 'signet', bolt11: 'lntbs10u1retry',
      bridgeActivityId: 'receive_retry', satsAmount: 1_000, terminalStatus: 'failed',
      reason: 'receive intent already used',
    })).resolves.toEqual({ failed: false, duplicate: true });

    await expect(t.mutation((internal as any).wavelength.markSettled, {
      requestId: ids.requestId,
      paymentHash: 'late_settlement_hash',
    })).rejects.toThrow('WAVELENGTH_PAYMENT_NOT_SETTLED');
    expect(await t.run((ctx) => ctx.db.get(ids.requestId))).toMatchObject({ status: 'failed' });
    expect(await t.run((ctx) => ctx.db.get(ids.paymentId))).toMatchObject({ status: 'failed' });
  });

  it('refuses to retire an invoice when its linked payment already settled', async () => {
    const t = convexTest(schema, modules);
    const requestId = await t.run(async (ctx) => {
      const propertyId = await ctx.db.insert('properties', { name: 'Consensus Commons', slug: 'consensus-commons',
        timezone: 'America/Toronto', currency: 'CAD', taxRateBps: 0, taxLabel: 'HST', email: 'staff@example.test',
        phone: '', address: 'Toronto', checkInTime: '16:00', checkOutTime: '11:00', active: true });
      const unitTypeId = await ctx.db.insert('unitTypes', { propertyId, name: 'Node', slug: 'node', kind: 'room', bookingMode: 'nightly',
        description: '', photoUrls: [], maxOccupancy: 2, amenities: [], comingSoon: false, sortOrder: 1 });
      const unitId = await ctx.db.insert('units', { propertyId, unitTypeId, name: 'Node 1', slug: 'node-1', status: 'active',
        icalExportToken: 'paid-test', icalImports: [], sortOrder: 1 });
      const now = Date.now();
      const bookingId = await ctx.db.insert('bookings', { propertyId, unitTypeId, unitId, checkIn: '2026-08-20', checkOut: '2026-08-21',
        nights: 1, adults: 1, children: 0, status: 'confirmed', source: 'demo', confirmationCode: 'OS-PAID',
        statusHistory: [{ status: 'confirmed', ts: now }], notes: [], createdAt: now, updatedAt: now });
      const paymentId = await ctx.db.insert('payments', { propertyId, bookingId, provider: 'wavelength', amountCents: 21,
        gstCents: 0, currency: 'CAD', status: 'paid', providerPaymentId: 'paid_hash', paidAt: now, refunds: [], createdAt: now });
      return await ctx.db.insert('wavelengthRequests', { propertyId, bookingId, paymentId,
        quotedAmountCents: 21, currency: 'CAD', network: 'signet', satsAmount: 1_000, expiresAt: now + 600_000,
        bolt11: 'lntbs10u1paid', bridgeActivityId: 'receive_paid', status: 'invoice_ready',
        createdAt: now, updatedAt: now, claimedAt: now });
    });

    await expect(t.mutation((internal as any).wavelength.markFailed, {
      requestId, network: 'signet', bolt11: 'lntbs10u1paid', bridgeActivityId: 'receive_paid',
      satsAmount: 1_000, terminalStatus: 'failed', reason: 'stale failure',
    })).rejects.toThrow('WAVELENGTH_PAYMENT_NOT_PENDING');
    expect(await t.run((ctx) => ctx.db.get(requestId))).toMatchObject({ status: 'invoice_ready' });
  });

  it('reconciles a paid invoice to settled across the confirmation-to-finalization crash window', async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) => {
      const propertyId = await ctx.db.insert('properties', { name: 'Consensus Commons', slug: 'consensus-commons',
        timezone: 'America/Toronto', currency: 'CAD', taxRateBps: 0, taxLabel: 'HST', email: 'staff@example.test',
        phone: '', address: 'Toronto', checkInTime: '16:00', checkOutTime: '11:00', active: true });
      const unitTypeId = await ctx.db.insert('unitTypes', { propertyId, name: 'Node', slug: 'node', kind: 'room', bookingMode: 'nightly',
        description: '', photoUrls: [], maxOccupancy: 2, amenities: [], comingSoon: false, sortOrder: 1 });
      const unitId = await ctx.db.insert('units', { propertyId, unitTypeId, name: 'Node 1', slug: 'node-1', status: 'active',
        icalExportToken: 'settlement-recovery', icalImports: [], sortOrder: 1 });
      const now = Date.now();
      const bookingId = await ctx.db.insert('bookings', { propertyId, unitTypeId, unitId, checkIn: '2026-08-22', checkOut: '2026-08-23',
        nights: 1, adults: 1, children: 0, status: 'confirmed', source: 'demo', confirmationCode: 'OS-RECOVERY',
        statusHistory: [{ status: 'confirmed', ts: now }], notes: [], createdAt: now, updatedAt: now });
      const paymentId = await ctx.db.insert('payments', { propertyId, bookingId, provider: 'wavelength', amountCents: 21,
        gstCents: 0, currency: 'CAD', status: 'paid', providerPaymentId: 'recovery_hash',
        paidAt: now, refunds: [], createdAt: now });
      const requestId = await ctx.db.insert('wavelengthRequests', { propertyId, bookingId, paymentId,
        quotedAmountCents: 21, currency: 'CAD', network: 'signet', satsAmount: 1_000, expiresAt: now + 600_000,
        bolt11: 'lntbs10u1recovery', bridgeActivityId: 'receive_recovery', status: 'invoice_ready',
        createdAt: now, updatedAt: now, claimedAt: now });
      return { requestId, paymentId };
    });

    expect(await t.mutation((internal as any).wavelength.claimPending, { limit: 10 })).toEqual([]);
    expect(await t.run((ctx) => ctx.db.get(ids.requestId))).toMatchObject({
      status: 'settled', paymentHash: 'recovery_hash',
    });

    await t.run(async (ctx) => {
      await ctx.db.patch(ids.requestId, { status: 'failed', failureReason: 'simulated old crash state' });
    });
    await expect(t.mutation((internal as any).wavelength.markSettled, {
      requestId: ids.requestId,
      paymentHash: 'recovery_hash',
    })).resolves.toEqual({ settled: true });
    expect(await t.run((ctx) => ctx.db.get(ids.paymentId))).toMatchObject({
      status: 'paid', providerPaymentId: 'recovery_hash',
    });
    expect(await t.run((ctx) => ctx.db.get(ids.requestId))).toMatchObject({
      status: 'settled', paymentHash: 'recovery_hash',
    });
  });
});
