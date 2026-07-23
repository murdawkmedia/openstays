import { v } from 'convex/values';

export const LEGACY_CONSENSUS_REWARD_SATS = 210 as const;
export const CONSENSUS_REWARD_SATS = 1_000 as const;

export const consensusRewardSats = v.union(
  v.literal(LEGACY_CONSENSUS_REWARD_SATS),
  v.literal(CONSENSUS_REWARD_SATS),
);
