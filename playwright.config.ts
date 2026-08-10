import { defineConfig, devices } from '@playwright/test';

const e2eConvexUrl = process.env.OPENSTAYS_E2E_CONVEX_URL
  ?? process.env.VITE_CONVEX_URL
  ?? 'https://shiny-bison-351.convex.cloud';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: false,
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    channel: 'chrome',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4174',
    url: 'http://127.0.0.1:4174',
    env: {
      VITE_CONVEX_URL: e2eConvexUrl,
      VITE_PUBLIC_SHOWCASE: 'true',
      VITE_PUBLIC_SIMULATED: 'true',
      VITE_PUBLIC_WAVELENGTH: 'true',
      VITE_PUBLIC_ZAPRITE: 'false',
      VITE_PUBLIC_STAFF: 'false',
    },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
