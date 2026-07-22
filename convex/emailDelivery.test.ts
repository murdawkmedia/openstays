/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';
import { mailBridgeAuthorized } from './emailDelivery';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');
const emailDelivery = (internal as any).emailDelivery;

async function queuedEmail() {
  const t = convexTest(schema, modules);
  const emailLogId = await t.run(async (ctx) => {
    const propertyId = await ctx.db.insert('properties', {
      name: 'Consensus Commons', slug: 'consensus-commons', timezone: 'America/Toronto',
      currency: 'CAD', taxRateBps: 1300, email: 'staff@example.test', phone: '555-0210',
      address: 'Toronto', checkInTime: '15:00', checkOutTime: '11:00', active: true,
    });
    return await ctx.db.insert('emailLog', {
      propertyId, to: 'guest@example.test', from: 'OpenStays <stays@example.test>',
      templateKey: 'confirmation', subject: 'Booking confirmed', html: '<p>Confirmed</p>',
      text: 'Confirmed', provider: 'mail_bridge', idempotencyKey: 'booking:1:confirmation',
      status: 'queued', attemptCount: 0, nextAttemptAt: Date.now(), ts: Date.now(),
    });
  });
  return { t, emailLogId };
}

afterEach(() => vi.useRealTimers());

describe('mail bridge authorization', () => {
  it('accepts only the exact bearer token', () => {
    expect(mailBridgeAuthorized('Bearer mail-secret', 'mail-secret')).toBe(true);
    expect(mailBridgeAuthorized('Bearer forged', 'mail-secret')).toBe(false);
    expect(mailBridgeAuthorized(undefined, 'mail-secret')).toBe(false);
  });
});

describe('durable email claims', () => {
  it('leases once and permits reclaim only after expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-22T18:00:00Z'));
    const { t, emailLogId } = await queuedEmail();
    const first = await t.mutation(emailDelivery.claimPending, { limit: 10, leaseToken: 'lease-1' });
    const second = await t.mutation(emailDelivery.claimPending, { limit: 10, leaseToken: 'lease-2' });
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ _id: emailLogId, leaseToken: 'lease-1' });
    expect(second).toHaveLength(0);

    vi.advanceTimersByTime(31_000);
    const reclaimed = await t.mutation(emailDelivery.claimPending, { limit: 10, leaseToken: 'lease-3' });
    expect(reclaimed).toHaveLength(1);
    expect(reclaimed[0]).toMatchObject({ _id: emailLogId, leaseToken: 'lease-3' });
  });

  it('marks delivery idempotently', async () => {
    const { t, emailLogId } = await queuedEmail();
    await t.mutation(emailDelivery.claimPending, { limit: 1, leaseToken: 'lease-delivery' });
    const first = await t.mutation(emailDelivery.markDelivered, {
      emailLogId, leaseToken: 'lease-delivery', providerMessageId: 'mailpit-123',
    });
    const second = await t.mutation(emailDelivery.markDelivered, {
      emailLogId, leaseToken: 'lease-delivery', providerMessageId: 'mailpit-123',
    });
    expect([first, second]).toEqual([{ delivered: true }, { delivered: false }]);
  });

  it('sanitizes failures and schedules bounded retries', async () => {
    const { t, emailLogId } = await queuedEmail();
    await t.mutation(emailDelivery.claimPending, { limit: 1, leaseToken: 'lease-failure' });
    const result = await t.mutation(emailDelivery.markFailed, {
      emailLogId, leaseToken: 'lease-failure', error: 'SMTP\r\npassword=secret\u0000', retryable: true,
    });
    expect(result).toMatchObject({ failed: true, terminal: false });
    const row = await t.run((ctx) => ctx.db.get(emailLogId));
    expect(row?.status).toBe('queued');
    expect(row?.error).not.toMatch(/[\r\n\u0000]/);
    expect(row?.attemptCount).toBe(1);
  });
});

describe('mail bridge HTTP endpoints', () => {
  it('rejects missing and forged bearer credentials before returning mail', async () => {
    vi.stubEnv('MAIL_BRIDGE_TOKEN', 'mail-secret');
    const { t } = await queuedEmail();
    const missing = await t.fetch('/mail-bridge/pending', { method: 'GET' });
    const forged = await t.fetch('/mail-bridge/pending', {
      method: 'GET', headers: { Authorization: 'Bearer forged' },
    });
    expect(missing.status).toBe(401);
    expect(forged.status).toBe(401);
  });

  it('claims a complete payload and acknowledges delivery', async () => {
    vi.stubEnv('MAIL_BRIDGE_TOKEN', 'mail-secret');
    const { t, emailLogId } = await queuedEmail();
    const pending = await t.fetch('/mail-bridge/pending', {
      method: 'GET', headers: { Authorization: 'Bearer mail-secret' },
    });
    expect(pending.status).toBe(200);
    const body = await pending.json() as { emails: Array<{ _id: string; leaseToken: string; html: string }> };
    expect(body.emails).toHaveLength(1);
    expect(body.emails[0]).toMatchObject({ _id: emailLogId, html: '<p>Confirmed</p>' });

    const delivered = await t.fetch('/mail-bridge/delivered', {
      method: 'POST',
      headers: { Authorization: 'Bearer mail-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        emailLogId, leaseToken: body.emails[0].leaseToken, providerMessageId: 'smtp-123',
      }),
    });
    expect(delivered.status).toBe(200);
    expect(await delivered.json()).toEqual({ delivered: true });
  });

  it('returns a conflict for a mismatched lease and reports valid failures', async () => {
    vi.stubEnv('MAIL_BRIDGE_TOKEN', 'mail-secret');
    const { t, emailLogId } = await queuedEmail();
    const pending = await t.fetch('/mail-bridge/pending', {
      method: 'GET', headers: { Authorization: 'Bearer mail-secret' },
    });
    const body = await pending.json() as { emails: Array<{ leaseToken: string }> };
    const headers = { Authorization: 'Bearer mail-secret', 'Content-Type': 'application/json' };
    const conflict = await t.fetch('/mail-bridge/failed', {
      method: 'POST', headers,
      body: JSON.stringify({ emailLogId, leaseToken: 'wrong', error: 'nope', retryable: true }),
    });
    expect(conflict.status).toBe(409);

    const failed = await t.fetch('/mail-bridge/failed', {
      method: 'POST', headers,
      body: JSON.stringify({
        emailLogId, leaseToken: body.emails[0].leaseToken, error: 'SMTP unavailable', retryable: true,
      }),
    });
    expect(failed.status).toBe(200);
    expect(await failed.json()).toMatchObject({ failed: true, terminal: false });
  });
});
