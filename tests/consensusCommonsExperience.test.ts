import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { consensusCommonsMedia, getConsensusAmenityAction } from '../shared/consensusCommonsExperience';

describe('Consensus Commons stay experience', () => {
  it('defines three fictional gallery images with useful alt text', () => {
    expect(consensusCommonsMedia.map((image) => image.src)).toEqual([
      '/demo/consensus-commons/exterior.webp',
      '/demo/consensus-commons/node-room.webp',
      '/demo/consensus-commons/hack-lounge.webp',
    ]);
    expect(consensusCommonsMedia.every((image) => image.alt.length >= 30)).toBe(true);
  });

  it('maps amenities to official links or the shared lounge image', () => {
    expect(getConsensusAmenityAction('consensus-commons', 'Fast Wi-Fi')).toMatchObject({
      kind: 'external', href: 'https://techspecs.ui.com/unifi/cloud-gateways/udr?subcategory=cloud-gateways-wifi-integrated',
    });
    expect(getConsensusAmenityAction('consensus-commons', 'Shared hack lounge')).toEqual({
      kind: 'gallery', imageIndex: 2,
    });
    expect(getConsensusAmenityAction('consensus-commons', 'Signet faucet guide')).toMatchObject({
      kind: 'external', href: 'https://bitcoinsignetfaucet.com/',
    });
    expect(getConsensusAmenityAction('consensus-commons', 'Late-night coffee')).toMatchObject({
      kind: 'external', href: 'https://www.lagolosagelateria.ca/',
    });
  });

  it('leaves amenities on ordinary properties noninteractive', () => {
    expect(getConsensusAmenityAction('pinewood-flats', 'Fast Wi-Fi')).toBeNull();
  });

  it('uses a keyboard-dismissible native dialog for the property gallery', () => {
    const source = readFileSync(new URL('../src/components/StayMedia.tsx', import.meta.url), 'utf8');
    expect(source).toContain('<dialog');
    expect(source).toContain('onCancel');
    expect(source).toContain('aria-label="Close property photo"');
    expect(source).toContain('lastTriggerRef.current?.focus()');
  });
});
