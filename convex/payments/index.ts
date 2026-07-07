import type { PaymentProvider, ProviderName } from './types';
import { stripeProvider } from './stripe';
import { squareProvider } from './square';

const providers: Record<ProviderName, PaymentProvider> = {
  stripe: stripeProvider,
  square: squareProvider,
};

export function getProvider(name: ProviderName): PaymentProvider {
  return providers[name];
}

/** Provider names this deployment can actually run (env vars present). */
export function configuredProviders(): ProviderName[] {
  return (Object.keys(providers) as ProviderName[]).filter((n) => providers[n].isConfigured());
}
