import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const checker = resolve('scripts/check-public-showcase-env.mjs');

function runChecker(overrides: Record<string, string | undefined>) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    VITE_PUBLIC_SHOWCASE: 'true',
    VITE_PUBLIC_WAVELENGTH: 'true',
    VITE_PUBLIC_ZAPRITE: 'false',
    VITE_CONVEX_URL: 'https://example.convex.cloud',
    VITE_PAYMENT_EDGE_URL: 'https://eligibility.example.workers.dev',
    VITE_TURNSTILE_SITE_KEY: '0x4AAAAAAExamplePublicKey',
    ...overrides,
  };

  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete env[name];
  }

  return spawnSync(process.execPath, [checker], {
    cwd: resolve('.'),
    encoding: 'utf8',
    env,
  });
}

describe('public showcase build preflight', () => {
  it('rejects the Turnstile placeholder that disabled live payments', () => {
    const result = runChecker({ VITE_TURNSTILE_SITE_KEY: '0' });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'VITE_TURNSTILE_SITE_KEY must be a real public Turnstile site key',
    );
  });

  it('runs automatically before every production build', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.prebuild).toContain(
      'node scripts/check-public-showcase-env.mjs',
    );
    expect(packageJson.scripts.prebuild).toContain(
      'node scripts/check-production-profile-env.mjs',
    );
  });
});
