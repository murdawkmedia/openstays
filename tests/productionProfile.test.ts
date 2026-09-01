import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  productionProfilePolicy,
} from '../scripts/production-profile-policy.mjs';

const generatedConvex = resolve('convex-production');

afterEach(() => {
  rmSync(generatedConvex, { recursive: true, force: true });
});

describe('production profile policy', () => {
  const safeEnvironment: Record<string, string | undefined> = {
    VITE_OPENSTAYS_PROFILE: 'production',
    VITE_PUBLIC_SHOWCASE: 'false',
    VITE_PUBLIC_WAVELENGTH: 'false',
    VITE_PUBLIC_SIMULATED: 'false',
    DEMO_MODE: 'false',
  };

  it('accepts only the exact production profile and fails closed on experimental flags', () => {
    expect(productionProfilePolicy(safeEnvironment)).toEqual({
      production: true,
      errors: [],
    });

    for (const [name, value] of [
      ['VITE_PUBLIC_SHOWCASE', 'true'],
      ['VITE_PUBLIC_WAVELENGTH', 'true'],
      ['VITE_PUBLIC_SIMULATED', 'true'],
      ['DEMO_MODE', 'true'],
    ] as const) {
      expect(productionProfilePolicy({ ...safeEnvironment, [name]: value }).errors)
        .toContain(`${name} must not be true in the production profile`);
    }
  });

  it('uses a dedicated production entry and removes wallet runtime artifacts', () => {
    const vite = readFileSync('vite.config.ts', 'utf8');
    expect(vite).toContain("process.env.VITE_OPENSTAYS_PROFILE === 'production'");
    expect(vite).toContain('/src/main.production.tsx');
    expect(vite).toContain("resolve('dist', 'wavewalletdk')");
    expect(vite).toContain("resolve('dist', 'wavewalletdk-isolated-v1')");
  });
});

describe('production Convex artifact', () => {
  it('generates only allow-listed production modules and omits experimental authority', () => {
    const result = spawnSync(process.execPath, ['scripts/prepare-production-convex.mjs'], {
      cwd: resolve('.'),
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(resolve(generatedConvex, 'schema.ts'))).toBe(true);
    expect(existsSync(resolve(generatedConvex, 'bookings.ts'))).toBe(true);
    expect(existsSync(resolve(generatedConvex, 'tsconfig.json'))).toBe(true);

    const productionBookings = readFileSync(resolve(generatedConvex, 'bookings.ts'), 'utf8');
    expect(productionBookings).not.toContain("payment.provider === 'zaprite' ||\n      )");
    expect(productionBookings).toContain("payment.provider === 'zaprite'\n      )");

    for (const file of [
      'consensus.ts',
      'consensusReceipts.ts',
      'demo.ts',
      'operationsHealth.ts',
      'publicMaintenance.ts',
      'treasury.ts',
      'wavelength.ts',
      'wavelengthRewards.ts',
      'rewardPolicy.ts',
    ]) {
      expect(existsSync(resolve(generatedConvex, file)), file).toBe(false);
    }

    const verification = spawnSync(process.execPath, ['scripts/verify-production-artifacts.mjs', '--convex-only'], {
      cwd: resolve('.'),
      encoding: 'utf8',
    });
    expect(verification.status, verification.stderr).toBe(0);
  });
});

describe('production build contract', () => {
  it('wires prebuild, postbuild, and production artifact commands into package scripts', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts.prebuild).toContain('check-production-profile-env.mjs');
    expect(packageJson.scripts.postbuild).toContain('verify-production-artifacts.mjs');
    expect(packageJson.scripts['production:convex:prepare']).toBe(
      'node scripts/prepare-production-convex.mjs',
    );
    expect(packageJson.scripts['production:verify']).toContain('production:convex:prepare');
  });
});
