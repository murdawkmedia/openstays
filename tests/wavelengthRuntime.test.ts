import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { wavelengthRuntimeOptions, wavelengthRuntimeUrl } from '../src/lib/wavelengthRuntime.js';

describe('wavelengthRuntimeUrl', () => {
  it('anchors runtime assets at the site root from nested wallet routes', () => {
    expect(wavelengthRuntimeUrl('http://127.0.0.1:5173/wallet/pay/booking_1?confirmation=OS-1'))
      .toBe('http://127.0.0.1:5173/wavewalletdk/');
  });

  it('uses the worker URL emitted by the app bundler', () => {
    expect(wavelengthRuntimeOptions('http://127.0.0.1:5173/wallet/pay/booking_1', '/assets/wave-worker.js'))
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

  it('passes scoped eligibility tokens without placing them in wallet URLs', () => {
    const payment = readFileSync(
      new URL('../src/pages/WavelengthWalletPage.tsx', import.meta.url),
      'utf8',
    );
    const reward = readFileSync(
      new URL('../src/pages/ConsensusRewardPage.tsx', import.meta.url),
      'utf8',
    );
    expect(payment).toContain("readEligibilityToken('wavelength_payment'");
    expect(payment).toContain('eligibilityToken');
    expect(payment).toContain("clearEligibilityToken('wavelength_payment'");
    expect(reward).toContain("readEligibilityToken('reward_claim'");
    expect(reward).toContain('eligibilityToken');
    expect(reward).toContain("clearEligibilityToken('reward_claim'");
    expect(payment).not.toMatch(/[?&]eligibilityToken=/);
    expect(reward).not.toMatch(/[?&]eligibilityToken=/);
  });
});
