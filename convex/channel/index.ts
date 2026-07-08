import type { ChannelManagerProvider, ChannelProviderName } from './types';
import { channexProvider } from './channex';

const providers: Record<ChannelProviderName, ChannelManagerProvider> = {
  channex: channexProvider,
};

/** The channel manager for this deployment (only Channex today). */
export function getChannelProvider(name: ChannelProviderName = 'channex'): ChannelManagerProvider {
  return providers[name];
}

/** True when a channel manager is configured (env vars present). */
export function channelConfigured(): boolean {
  return channexProvider.isConfigured();
}

export const CHANNEL_HORIZON_DAYS = 365; // how far ahead we push availability/rates
