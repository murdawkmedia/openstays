export const DEMO_WALLET_ATTEMPT_SATS = 1_000;
export const DEMO_WALLET_TARGET_ATTEMPTS = 12;
export const DEMO_WALLET_TARGET_SATS =
  DEMO_WALLET_ATTEMPT_SATS * DEMO_WALLET_TARGET_ATTEMPTS;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export function isLocalDemoWalletSetup(hostname: string, setupFlag: string | null) {
  return setupFlag === '1' && LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

export function demoWalletAttemptsFunded(spendableSats: number) {
  return Math.max(0, Math.floor(spendableSats / DEMO_WALLET_ATTEMPT_SATS));
}
