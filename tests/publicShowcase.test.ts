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

