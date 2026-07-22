import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConsensusReceiptSummary } from '../src/components/ConsensusReceiptSummary';

describe('ConsensusReceiptSummary', () => {
  it('distinguishes timestamp submission, Bitcoin anchoring, and the signet reward', () => {
    const html = renderToStaticMarkup(createElement(ConsensusReceiptSummary, {
      receipt: { publicId: 'cr_demo', status: 'submitted', sha256: 'a'.repeat(64), calendarCount: 2 },
      reward: { status: 'eligible', satsAmount: 210 }, rewardUrl: '/wallet/reward/OS-DEMO',
      onDownloadJson: () => undefined, onDownloadProof: () => undefined,
    }));
    expect(html).toContain('Timestamp submitted');
    expect(html).toContain('Bitcoin anchoring pending');
    expect(html).toContain('Claim 210 signet sats');
    expect(html).toContain('OpenTimestamps anchors to Bitcoin mainnet');
    expect(html).toContain('Wavelength reward uses signet test sats');
  });
});
