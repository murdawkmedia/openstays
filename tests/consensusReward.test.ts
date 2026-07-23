import { describe, expect, it } from 'vitest';
import { CONSENSUS_REWARD_LABEL, CONSENSUS_REWARD_SATS } from '../src/lib/consensusReward';

describe('consensus reward presentation', () => {
  it('uses the permanent Wavelength minimum reward', () => {
    expect(CONSENSUS_REWARD_SATS).toBe(1_000);
    expect(CONSENSUS_REWARD_LABEL).toBe('1,000 signet sats');
  });
});
