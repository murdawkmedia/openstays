import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const files = [
  '.env.example',
  'README.md',
  'cli/README.md',
  'docs/public-live-payments.md',
  'docs/operations/signet-treasury.md',
  'CLAUDE.md',
].map((path) => fs.existsSync(path) ? fs.readFileSync(path, 'utf8') : '').join('\n');

describe('Signet treasury documentation', () => {
  it('documents every inert-by-default control and public staff boundary', () => {
    for (const name of [
      'VITE_PUBLIC_STAFF',
      'WAVELENGTH_TREASURY_ENABLED',
      'WAVELENGTH_TREASURY_DRY_RUN',
      'WAVELENGTH_TREASURY_ADDRESS',
      'WAVELENGTH_TREASURY_RESERVE_SATS',
      'WAVELENGTH_TREASURY_MIN_SWEEP_SATS',
      'WAVELENGTH_TREASURY_COOLDOWN_MS',
    ]) expect(files).toContain(name);
    expect(files).toContain('/tour/operations');
  });

  it('documents bounded sends, durable reconciliation, and explicit live approval', () => {
    expect(files).toContain('never `sweepAll`');
    expect(files).toContain('reconciliation_required');
    expect(files).toContain('durable journal');
    expect(files).toContain('explicit approval');
    expect(files).toContain('signet');
    expect(files).toContain('mainnet');
  });

  it('documents both Wavelength checkout paths without accepting recovery words', () => {
    expect(files).toContain('Pay using Wavelength’s official demo wallet');
    expect(files).toContain('https://wavelength.lightning.engineering/demo/');
    expect(files).toContain('never enter a mainnet recovery phrase');
  });
});
