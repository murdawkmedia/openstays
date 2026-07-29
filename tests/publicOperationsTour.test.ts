import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import { PUBLIC_OPERATIONS_FIXTURE } from '../src/fixtures/publicOperationsFixture';

const PROHIBITED_KEYS = new Set([
  'email',
  'confirmationCode',
  'checkIn',
  'checkOut',
  'unitId',
  'unitName',
  'paymentHash',
  'invoice',
  'bolt11',
  'wallet',
  'walletData',
  'mnemonic',
  'seed',
]);

function collectKeys(value: unknown, keys: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return keys;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      collectKeys(child, keys);
    }
  }
  return keys;
}

describe('public operations fixture', () => {
  it('contains a realistic cross-section of fictional operations', () => {
    expect(PUBLIC_OPERATIONS_FIXTURE.notice).toBe('Read-only fictional demo');
    expect(PUBLIC_OPERATIONS_FIXTURE.records.map((record) => record.kind)).toEqual(
      expect.arrayContaining([
        'hold',
        'booking',
        'payment',
        'message',
        'refund',
        'receipt',
        'reward',
        'channel',
        'treasury',
      ]),
    );
  });

  it('does not contain identity, stay, invoice, payment-hash, or wallet fields', () => {
    const keys = collectKeys(PUBLIC_OPERATIONS_FIXTURE);
    expect(keys.filter((key) => PROHIBITED_KEYS.has(key))).toEqual([]);
    expect(JSON.stringify(PUBLIC_OPERATIONS_FIXTURE)).not.toMatch(
      /@|confirmation.?code|payment.?hash|recovery|mnemonic|seed phrase/i,
    );
  });
});

describe('public operations tour boundary', () => {
  it('uses source-controlled local state without Convex queries or mutations', () => {
    const source = fs.readFileSync('src/pages/PublicOperationsTourPage.tsx', 'utf8');
    expect(source).toContain('PUBLIC_OPERATIONS_FIXTURE');
    expect(source).toContain('useState');
    expect(source).not.toContain("from 'convex/react'");
    expect(source).not.toContain('../../convex/_generated/api');
    expect(source).not.toContain('useMutation');
    expect(source).not.toContain('useQuery');
  });

  it('keeps every write action disabled and explains how to perform it', () => {
    const source = fs.readFileSync('src/pages/PublicOperationsTourPage.tsx', 'utf8');
    expect(source).toContain('Read-only fictional demo');
    expect(source.match(/disabled/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(source.match(/Sign in to perform this action/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('makes the tour prominent while keeping staff sign-in available', () => {
    const source = fs.readFileSync('src/components/AppLayout.tsx', 'utf8');
    expect(source).toContain('Explore the backend');
    expect(source).toContain('Staff sign in');
    expect(source).toContain('/tour/operations');
    expect(source).toContain('/admin/login');
  });

  it('keeps account creation out of public showcase builds', () => {
    const source = fs.readFileSync('src/pages/AdminLoginPage.tsx', 'utf8');
    expect(source).toContain('PUBLIC_SHOWCASE.enabled');
    expect(source).toContain('PUBLIC_SHOWCASE.enabled ?');
    expect(source).toContain('Sign in');
  });
});
