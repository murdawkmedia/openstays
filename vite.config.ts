import { cpSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const publicShowcaseBuild = process.env.VITE_PUBLIC_SHOWCASE === 'true';
const includeWavelengthWallet = !publicShowcaseBuild
  || process.env.VITE_PUBLIC_WAVELENGTH === 'true';
const walletIsolation = () => (
  request: { url?: string },
  response: { setHeader: (name: string, value: string) => void },
  next: () => void,
) => {
  if (request.url?.startsWith('/wallet/')) {
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  }
  if (
    request.url?.startsWith('/wavewalletdk/')
    || request.url?.includes('wavewalletdk-worker')
  ) {
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  }
  next();
};

// base is '/' locally and on Cloudflare Pages; the GH Pages demo build
// overrides it via VITE_BASE (see .github/workflows/pages.yml).
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
  base: process.env.VITE_BASE ?? '/',
});
