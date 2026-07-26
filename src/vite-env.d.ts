/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CONVEX_URL: string;
  readonly VITE_PUBLIC_SHOWCASE?: string;
  readonly VITE_PUBLIC_WAVELENGTH?: string;
  readonly VITE_PUBLIC_ZAPRITE?: string;
  readonly VITE_PUBLIC_SIMULATED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
