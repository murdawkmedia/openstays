import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': fileURLToPath(
        new URL('./tests/cloudflareWorkersShim.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    restoreMocks: true,
    testTimeout: 10_000,
    unstubGlobals: true,
  },
});
