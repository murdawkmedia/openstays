import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('public live payment disclosure', () => {
  it('requires explicit consent and keeps marketing independent', () => {
    const component = fs.readFileSync(
      'src/components/LivePaymentDisclosure.tsx',
      'utf8',
    );
    expect(component).toContain('No accommodation, reservation, or other lodging service');
    expect(component).toContain('voluntary contribution');
    expect(component).toContain('not tax-deductible');
    expect(component).toContain('no charitable receipt');
    expect(component).toContain('refund');
    expect(component).toContain('signet test sats');
    expect(component).toContain('checked={accepted}');
    expect(component).not.toContain('marketingOptIn');
  });

  it('mounts Turnstile on checkout rather than an isolated wallet route', () => {
    const challenge = fs.readFileSync(
      'src/components/TurnstileChallenge.tsx',
      'utf8',
    );
    const checkout = fs.readFileSync('src/pages/CheckoutPage.tsx', 'utf8');
    const wallet = fs.readFileSync('src/pages/WavelengthWalletPage.tsx', 'utf8');
    expect(challenge).toContain('challenges.cloudflare.com/turnstile/v0/api.js');
    expect(checkout).toContain('TurnstileChallenge');
    expect(wallet).not.toContain('TurnstileChallenge');
  });
});
