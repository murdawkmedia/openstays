import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const publicShowcaseBuild = process.env.VITE_PUBLIC_SHOWCASE === 'true';

// base is '/' locally and on Cloudflare Pages; the GH Pages demo build
// overrides it via VITE_BASE (see .github/workflows/pages.yml).
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'public-showcase-omit-wallet-runtime',
      closeBundle() {
        if (publicShowcaseBuild) {
          rmSync(resolve('dist', 'wavewalletdk'), { recursive: true, force: true });
        }
      },
    },
  ],
  base: process.env.VITE_BASE ?? '/',
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
