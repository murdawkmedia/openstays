import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/!(*.*.*)*.*s');

afterEach(() => vi.unstubAllEnvs());

describe('demo reset safety', () => {
  it('refuses destructive reset whenever public live mode is configured', async () => {
    vi.stubEnv('DEMO_MODE', 'true');
    vi.stubEnv('PUBLIC_LIVE_PAYMENTS', 'true');
    const t = convexTest(schema, modules);
    await expect(t.mutation(internal.demo.reset, {}))
      .rejects.toThrow('LIVE_RESET_PROHIBITED');
  });
});
