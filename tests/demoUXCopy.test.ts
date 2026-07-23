import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { extractErrorMessage } from '../src/components/ErrorMessage';

describe('judge-facing checkout copy', () => {
  it('states that marketing consent is recorded but no campaign is sent', () => {
    const source = readFileSync(new URL('../src/components/GuestForm.tsx', import.meta.url), 'utf8');
    expect(source).toContain('Consent is recorded with your reservation; this demo does not send marketing campaigns.');
  });

  it('suggests the working Consensus Commons promo code', () => {
    const source = readFileSync(new URL('../src/pages/UnitTypePage.tsx', import.meta.url), 'utf8');
    expect(source).toContain("detail.property.slug === 'consensus-commons' ? 'CONSENSUS10' : 'WELCOME10'");
  });
});

describe('staff auth errors', () => {
  it('does not expose missing signing-key internals to a guest', () => {
    const message = extractErrorMessage(new Error('Server Error: Missing environment variable "JWT_PRIVATE_KEY"'));
    expect(message).toBe('Staff authentication is not configured on this demo deployment yet.');
    expect(message).not.toContain('JWT_PRIVATE_KEY');
  });
});
