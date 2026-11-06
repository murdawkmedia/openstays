import { cpSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const publicShowcaseBuild = process.env.VITE_PUBLIC_SHOWCASE === 'true';
const includeWavelengthWallet = !publicShowcaseBuild
  || process.env.VITE_PUBLIC_WAVELENGTH === 'true';
const appBase = process.env.VITE_BASE ?? '/';
const walletIsolation = () => (
  request: { url?: string },
  response: { setHeader: (name: string, value: string) => void },
  next: () => void,
) => {
  const pathname = request.url?.split('?')[0] ?? '/';
  const appPath = pathname.startsWith(appBase) ? `/${pathname.slice(appBase.length)}` : pathname;
  if (appPath.startsWith('/wallet/')) {
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  }
  if (
    appPath.startsWith('/wavewalletdk/')
    || appPath.startsWith('/wavewalletdk-isolated-v1/')
    || appPath.includes('wavewalletdk-worker')
  ) {
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  }
  next();
};

// The showcase release uses VITE_BASE=/openstays/ under the studio domain.
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'public-showcase-omit-wallet-runtime',
      closeBundle() {
        if (!includeWavelengthWallet) {
          rmSync(resolve('dist', 'wavewalletdk'), { recursive: true, force: true });
        }
      },
    },
    {
      name: 'public-showcase-compress-wallet-runtime',
      closeBundle() {
        if (publicShowcaseBuild && includeWavelengthWallet) {
          rmSync(resolve('dist', 'wavewalletdk', 'wavewalletdk.wasm'), {
            force: true,
          });
        }
      },
    },
    {
      name: 'public-showcase-version-wallet-runtime',
      closeBundle() {
        if (publicShowcaseBuild && includeWavelengthWallet) {
          const versionedRuntime = resolve('dist', 'wavewalletdk-isolated-v1');
          rmSync(versionedRuntime, { recursive: true, force: true });
          cpSync(resolve('dist', 'wavewalletdk'), versionedRuntime, {
            recursive: true,
          });
        }
      },
    },
    {
      name: 'wallet-route-cross-origin-isolation',
      configureServer(server) {
        server.middlewares.use(walletIsolation());
      },
      configurePreviewServer(server) {
        server.middlewares.use(walletIsolation());
      },
    },
  ],
  base: appBase,
});
