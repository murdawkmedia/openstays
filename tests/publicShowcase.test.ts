import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import { publicShowcasePolicy } from '../src/lib/publicShowcase';

describe('publicShowcasePolicy', () => {
  it('fails closed when the flag is absent', () => {
    expect(publicShowcasePolicy(undefined)).toEqual({
      enabled: false,
      allowLiveWavelength: true,
      allowLiveZaprite: true,
      allowSimulated: true,
      allowStaffRoutes: true,
    });
  });

  it('keeps staff closed while independently enabling public rails', () => {
    expect(publicShowcasePolicy('true', 'true', 'false', 'true')).toEqual({
      enabled: true,
      allowLiveWavelength: true,
      allowLiveZaprite: false,
      allowSimulated: true,
      allowStaffRoutes: false,
    });
  });

  it('does not accept truthy misspellings', () => {
    expect(publicShowcasePolicy('TRUE').enabled).toBe(false);
    expect(publicShowcasePolicy('1').enabled).toBe(false);
  });
});

describe('public showcase copy and routing', () => {
  it('publishes the honest network and finality language', () => {
    const source = fs.readFileSync('src/pages/PublicShowcasePage.tsx', 'utf8');
    expect(source).toContain('signet test sats');
    expect(source).toContain('pending Bitcoin confirmation');
    expect(source).toContain('Bitcoin anchored');
    expect(source).toContain('fictional');
    expect(source).toContain('adapter ready, not connected');
  });

  it('includes only explicitly enabled public wallet surfaces while staff stays blocked', () => {
    const main = fs.readFileSync('src/main.tsx', 'utf8');
    expect(main).toContain('PublicShowcaseBoundaryPage');
    expect(main).toContain('PUBLIC_SHOWCASE.allowLiveWavelength');
    expect(main).toContain('PUBLIC_SHOWCASE.allowStaffRoutes');
    expect(main).toContain(
      "const IS_PUBLIC_SHOWCASE_BUILD = import.meta.env.VITE_PUBLIC_SHOWCASE === 'true'",
    );
    expect(main).toContain(
      "const INCLUDE_WAVELENGTH_WALLET = !IS_PUBLIC_SHOWCASE_BUILD",
    );
    expect(main).toContain("import.meta.env.VITE_PUBLIC_WAVELENGTH === 'true'");
    expect(main).toContain(
      "INCLUDE_WAVELENGTH_WALLET ? lazy(() => import('./pages/WavelengthWalletPage')) : null",
    );
    expect(main).toContain('path="/wallet/pay/:bookingId"');
    expect(main).toContain('path="/wallet/reward/:code"');
  });

  it('requires a scoped eligibility handoff before public Wavelength checkout', () => {
    const checkout = fs.readFileSync('src/pages/CheckoutPage.tsx', 'utf8');
    expect(checkout).toContain('PUBLIC_SHOWCASE.allowLiveWavelength');
    expect(checkout).toContain("action: 'wavelength_payment'");
    expect(checkout).toContain('storeEligibilityToken');
    expect(checkout).toContain('navigate(walletPath');
  });
});
