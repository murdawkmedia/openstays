import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base is '/' locally and on Cloudflare Pages; the GH Pages demo build
// overrides it via VITE_BASE (see .github/workflows/pages.yml).
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE ?? '/',
});
