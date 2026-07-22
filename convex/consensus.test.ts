import { describe, expect, it } from 'vitest';
import { buildConsensusTimeline } from './consensus';

describe('consensus timeline', () => {
  it('derives agreement from independent booking subsystems', () => {
    const timeline = buildConsensusTimeline({
      statusHistory: ['hold', 'confirmed'], paymentCount: 1, paid: true,
      emailDelivered: true, messageCount: 2, openRefundCount: 0,
      channelMapped: false, channelDirty: false,
      receiptStatus: 'submitted', rewardStatus: 'paid',
    });
    expect(timeline.map((step) => step.state)).toEqual(['reached', 'reached', 'reached', 'reached', 'reached', 'reached', 'reached', 'ready']);
    expect(timeline[4].detail).toContain('2 messages');
    expect(timeline[5].detail).toContain('OpenTimestamps');
    expect(timeline[6].detail).toContain('210 signet sats');
    expect(timeline[7].detail).toContain('not connected');
  });
  it('surfaces unresolved refund disagreement', () => {
    const timeline = buildConsensusTimeline({
      statusHistory: ['hold', 'cancelled'], paymentCount: 1, paid: true,
      emailDelivered: false, messageCount: 0, openRefundCount: 1,
      channelMapped: true, channelDirty: true,
      receiptStatus: undefined, rewardStatus: undefined,
    });
    expect(timeline[2]).toMatchObject({ state: 'attention' });
    expect(timeline[2].detail).toContain('manual refund');
  });
});
