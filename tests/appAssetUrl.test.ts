import { afterEach, expect, it, vi } from 'vitest';
import { appAssetUrl } from '../src/lib/appAssetUrl';

afterEach(() => vi.unstubAllEnvs());

it('keeps seeded demo media in the hosted app without changing external media', () => {
  vi.stubEnv('BASE_URL', '/openstays/');
  expect(appAssetUrl('/demo/consensus-commons/node-room.webp'))
    .toBe('/openstays/demo/consensus-commons/node-room.webp');
  expect(appAssetUrl('https://images.example.org/photo.webp'))
    .toBe('https://images.example.org/photo.webp');
  vi.stubEnv('BASE_URL', '/');
  expect(appAssetUrl('/demo/consensus-commons/node-room.webp'))
    .toBe('/demo/consensus-commons/node-room.webp');
});
