import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { wavelengthRuntimeOptions, wavelengthRuntimeUrl } from '../src/lib/wavelengthRuntime.js';

describe('wavelengthRuntimeUrl', () => {
  it('anchors runtime assets at the site root from nested wallet routes', () => {
    expect(wavelengthRuntimeUrl('http://127.0.0.1:5173/wallet/booking_1?confirmation=OS-1'))
      .toBe('http://127.0.0.1:5173/wavewalletdk/');
  });

  it('uses the worker URL emitted by the app bundler', () => {
    expect(wavelengthRuntimeOptions('http://127.0.0.1:5173/wallet/booking_1', '/assets/wave-worker.js'))
      .toEqual({ runtimeBaseUrl: 'http://127.0.0.1:5173/wavewalletdk/', workerURL: '/assets/wave-worker.js' });
  });

  it.each(['WavelengthWalletPage.tsx', 'ConsensusRewardPage.tsx'])(
    'creates one wallet engine at module scope in %s',
    (page) => {
      const source = readFileSync(new URL(`../src/pages/${page}`, import.meta.url), 'utf8');
      expect(source).not.toContain('useState(() => createWebWalletEngine');
      expect(source).toMatch(/const wavelengthEngine = createWebWalletEngine/);
    },
  );
});
