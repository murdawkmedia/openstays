import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConsensusReceiptSummary } from '../src/components/ConsensusReceiptSummary';

const canonicalJson = JSON.stringify({
  bookingCommitment: 'opaque-booking',
  consensus: {
    bookingStatus: 'confirmed',
    channelEventsDigest: 'channel-digest',
    notificationEventsDigest: 'notification-digest',
    paymentEventsDigest: 'payment-digest',
    statusHistoryDigest: 'status-digest',
  },
  createdAt: 1_753_286_400_000,
  economic: {
    amountCents: 19,
    currency: 'CAD',
    paymentProvider: 'wavelength',
    paymentStatus: 'paid',
  },
  property: { name: 'Consensus Commons', slug: 'consensus-commons' },
  schema: 'openstays.consensus-receipt.v1',
});

describe('ConsensusReceiptSummary', () => {
  it('shows a submitted receipt with its privacy-safe contents and verifier instructions', () => {
    const html = renderToStaticMarkup(createElement(ConsensusReceiptSummary, {
      receipt: {
        publicId: 'cr_demo', status: 'submitted', sha256: 'a'.repeat(64), calendarCount: 2,
        canonicalJson, schemaVersion: 'openstays.consensus-receipt.v1',
      },
      reward: { status: 'eligible', satsAmount: 1_000 }, rewardUrl: '/wallet/reward/OS-DEMO',
      onDownloadJson: () => undefined, onDownloadProof: () => undefined,
    }));
    expect(html).toContain('Timestamp submitted');
    expect(html).toContain('Bitcoin anchoring pending');
    expect(html).toContain('Claim 1,000 signet sats');
    expect(html).toContain('OpenTimestamps anchors to Bitcoin mainnet');
    expect(html).toContain('Wavelength reward uses signet test sats');
    expect(html).toContain('Receipt contents');
    expect(html).toContain('Consensus Commons');
    expect(html).toContain('CA$0.19');
    expect(html).toContain('wavelength');
    expect(html).toContain('View canonical receipt');
    expect(html).toContain('Verify at OpenTimestamps.org');
    expect(html).toContain('Upload the receipt JSON and matching .ots proof.');
    expect(html).toContain('href="https://opentimestamps.org/"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
    expect(html).not.toContain('mempool.space');
  });

  it('links an anchored receipt to its verified Bitcoin block', () => {
    const html = renderToStaticMarkup(createElement(ConsensusReceiptSummary, {
      receipt: {
        publicId: 'cr_demo', status: 'bitcoin_anchored', sha256: 'a'.repeat(64), calendarCount: 2,
        canonicalJson, schemaVersion: 'openstays.consensus-receipt.v1', bitcoinBlockHeight: 959_201,
      },
      reward: { status: 'paid', satsAmount: 1_000 }, rewardUrl: '/wallet/reward/OS-DEMO',
      onDownloadJson: () => undefined, onDownloadProof: () => undefined,
    }));

    expect(html).toContain('href="https://mempool.space/block-height/959201"');
  });

  it('keeps receipt downloads available when canonical JSON cannot be previewed', () => {
    const html = renderToStaticMarkup(createElement(ConsensusReceiptSummary, {
      receipt: {
        publicId: 'cr_demo', status: 'submitted', sha256: 'a'.repeat(64), canonicalJson: '{',
        schemaVersion: 'openstays.consensus-receipt.v1', proofBase64: 'proof',
      },
      reward: null, rewardUrl: '/wallet/reward/OS-DEMO',
      onDownloadJson: () => undefined, onDownloadProof: () => undefined,
    }));

    expect(html).toContain('Receipt preview unavailable');
    expect(html).toContain('Download receipt JSON');
    expect(html).toContain('Download .ots proof');
  });
});
