/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONVEX_URL: string;
  readonly VITE_PUBLIC_SHOWCASE?: string;
  readonly VITE_PUBLIC_WAVELENGTH?: string;
  readonly VITE_PUBLIC_ZAPRITE?: string;
  readonly VITE_PUBLIC_SIMULATED?: string;
  readonly VITE_TURNSTILE_SITE_KEY?: string;
  readonly VITE_PAYMENT_EDGE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
