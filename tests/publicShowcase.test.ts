import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

import { publicShowcasePolicy } from '../src/lib/publicShowcase';

describe('publicShowcasePolicy', () => {
  it('fails closed when the flag is absent', () => {
    expect(publicShowcasePolicy(undefined)).toEqual({
      enabled: false,
      allowLiveWavelength: true,
      allowStaffRoutes: true,
    });
  });

  it('blocks live wallet and staff routes in the public build', () => {
    expect(publicShowcasePolicy('true')).toEqual({
      enabled: true,
      allowLiveWavelength: false,
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

  it('blocks unavailable public wallet and staff surfaces', () => {
    const main = fs.readFileSync('src/main.tsx', 'utf8');
    expect(main).toContain('PublicShowcaseBoundaryPage');
    expect(main).toContain('PUBLIC_SHOWCASE.allowLiveWavelength');
    expect(main).toContain('PUBLIC_SHOWCASE.allowStaffRoutes');
  });
});
