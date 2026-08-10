import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const config = readFileSync(new URL('../playwright.config.ts', import.meta.url), 'utf8');

describe('Playwright smoke configuration', () => {
  it('starts a hermetic public-showcase server instead of inheriting a developer shell', () => {
    expect(config).toContain("VITE_PUBLIC_SHOWCASE: 'true'");
    expect(config).toContain("VITE_PUBLIC_SIMULATED: 'true'");
    expect(config).toContain('OPENSTAYS_E2E_CONVEX_URL');
    expect(config).toContain('reuseExistingServer: false');
  });
});
