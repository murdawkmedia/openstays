/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');

async function seedHold(amountCents = 21) {
  const t = convexTest(schema, modules);
  const ids = await t.run(async (ctx) => {
    const propertyId = await ctx.db.insert('properties', {
      name: 'Consensus Commons', slug: 'consensus-commons', timezone: 'America/Toronto',
      currency: 'CAD', taxRateBps: 1300, taxLabel: 'HST', email: 'staff@example.test',
      phone: '416-555-0210', address: 'Toronto', checkInTime: '16:00',
      checkOutTime: '11:00', active: true,
    });
    const unitTypeId = await ctx.db.insert('unitTypes', {
      propertyId, name: 'Node Room', slug: 'node-room', kind: 'room', bookingMode: 'nightly',
      description: '', photoUrls: [], maxOccupancy: 2, amenities: [], comingSoon: false, sortOrder: 1,
    });
    const unitId = await ctx.db.insert('units', {
      propertyId, unitTypeId, name: 'Node 210', slug: 'node-210', status: 'active',
      icalExportToken: 'node-210-token', icalImports: [], sortOrder: 1,
    });
    const guestId = await ctx.db.insert('guests', {
      propertyId, name: 'Satoshi Guest', email: 'satoshi@example.test', phone: '416-555-1212',
      normalizedEmail: 'satoshi@example.test', normalizedPhone: '4165551212',
      marketingOptIn: false, notes: [],
    });
    const now = Date.now();
    const bookingId = await ctx.db.insert('bookings', {
      propertyId, unitId, unitTypeId, guestId, checkIn: '2026-07-23', checkOut: '2026-07-24',
      nights: 1, adults: 1, children: 0, status: 'hold', holdExpiresAt: now + 600_000,
      source: 'demo', confirmationCode: 'OS-MAIN21',
      priceBreakdown: {
        nightlySubtotalCents: amountCents, addOnSubtotalCents: 0, promoDiscountCents: 0,
        taxableSubtotalCents: amountCents, gstCents: 0, totalCents: amountCents,
        giftCertAppliedCents: 0, depositDueCents: amountCents, balanceDueCents: 0,
      },
      statusHistory: [{ status: 'hold', ts: now }], notes: [], createdAt: now, updatedAt: now,
    });
    return { bookingId };
  });
  return { t, ...ids };
}

function enableMainnet() {
  vi.stubEnv('WAVELENGTH_NETWORK', 'mainnet');
  vi.stubEnv('WAVELENGTH_MAINNET_ACK', 'I_UNDERSTAND_REAL_SATS');
  vi.stubEnv('WAVELENGTH_MAINNET_BRIDGE_TOKEN', 'mainnet-bridge-token');
}

afterEach(() => vi.unstubAllEnvs());

describe('guarded Wavelength mainnet requests', () => {
  it('snapshots mainnet and exactly 210 sats for the 21-cent demo hold', async () => {
    enableMainnet();
    const { t, bookingId } = await seedHold();
    const request = await t.mutation(api.wavelength.createRequest, {
      bookingId, confirmationCode: 'os-main21', email: 'SATOSHI@example.test',
    });
    expect(request).toMatchObject({ network: 'mainnet', satsAmount: 210, quotedAmountCents: 21 });
  });

  it('requires the explicit real-sats acknowledgement', async () => {
    vi.stubEnv('WAVELENGTH_NETWORK', 'mainnet');
    vi.stubEnv('WAVELENGTH_MAINNET_BRIDGE_TOKEN', 'mainnet-bridge-token');
    const { t, bookingId } = await seedHold();
    await expect(t.mutation(api.wavelength.createRequest, {
      bookingId, confirmationCode: 'OS-MAIN21', email: 'satoshi@example.test',
    })).rejects.toThrow('WAVELENGTH_MAINNET_NOT_ACKNOWLEDGED');
  });

  it('requires the fixed 21-cent demo booking price', async () => {
    enableMainnet();
    const { t, bookingId } = await seedHold(22);
    await expect(t.mutation(api.wavelength.createRequest, {
      bookingId, confirmationCode: 'OS-MAIN21', email: 'satoshi@example.test',
    })).rejects.toThrow('WAVELENGTH_MAINNET_DEMO_PRICE_REQUIRED');
  });

  it('requires matching network and amount at invoice and settlement', async () => {
    enableMainnet();
    const { t, bookingId } = await seedHold();
    const request = await t.mutation(api.wavelength.createRequest, {
      bookingId, confirmationCode: 'OS-MAIN21', email: 'satoshi@example.test',
    });
    await expect(t.mutation(internal.wavelength.publishInvoice, {
      requestId: request!._id, network: 'signet', bolt11: 'lnbc210-mainnet',
      bridgeActivityId: 'activity-210', satsAmount: 210, expiresAt: Date.now() + 300_000,
    })).rejects.toThrow('WAVELENGTH_NETWORK_MISMATCH');
    await t.mutation(internal.wavelength.publishInvoice, {
      requestId: request!._id, network: 'mainnet', bolt11: 'lnbc210-mainnet',
      bridgeActivityId: 'activity-210', satsAmount: 210, expiresAt: Date.now() + 300_000,
    });
    for (const satsAmount of [209, 211]) {
      await expect(t.mutation(internal.wavelength.prepareSettlement, {
        requestId: request!._id, network: 'mainnet', bolt11: 'lnbc210-mainnet',
        bridgeActivityId: 'activity-210', paymentHash: `hash-${satsAmount}`, satsAmount,
      })).rejects.toThrow('WAVELENGTH_SETTLEMENT_MISMATCH');
    }
  });
});
