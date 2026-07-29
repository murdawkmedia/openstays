import { useEffect, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { useParams, useSearchParams } from 'react-router-dom';
import { createWebWalletEngine, defaultConfig } from '@lightninglabs/wavelength-web';
import wavelengthWorkerUrl from '@lightninglabs/wavelength-web/wavewalletdk-worker.js?url';
import { WavelengthProvider, useWallet, useWalletBalance, useWalletCreate, useWalletReceive, useWalletUnlock } from '@lightninglabs/wavelength-react';
import { api } from '../../convex/_generated/api';
import { Bolt11Invoice } from '../components/Bolt11Invoice';
import {
  OPENSTAYS_WAVELENGTH_DATA_DIR,
  wavelengthRuntimeOptions,
} from '../lib/wavelengthRuntime';
import { CONSENSUS_REWARD_LABEL, CONSENSUS_REWARD_SATS } from '../lib/consensusReward';
import {
  clearEligibilityToken,
  readEligibilityToken,
} from '../lib/livePayments';
import { PUBLIC_SHOWCASE } from '../lib/publicShowcase';
import { FictionalBookingNotice } from '../components/FictionalBookingNotice';

const wavelengthEngine = createWebWalletEngine({
  ...wavelengthRuntimeOptions(window.location.href, wavelengthWorkerUrl),
  config: defaultConfig('signet', {
    dataDir: OPENSTAYS_WAVELENGTH_DATA_DIR,
  }),
  autoStart: true,
});

function RewardWallet() {
  const { code = '' } = useParams();
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const auth = code && email.includes('@') ? { confirmationCode: code, email } : 'skip';
  const receipt = useQuery((api as any).consensusReceipts.forGuest, auth) as any;
  const reward = useQuery((api as any).wavelengthRewards.forGuest, auth) as any;
  const operations = useQuery((api as any).operationsHealth.publicAvailability) as
    | { rewardAvailable: boolean }
    | undefined;
  const rewardInvoiceHasValidExpiry = typeof reward?.invoiceExpiresAt === 'number' && Number.isFinite(reward.invoiceExpiresAt);
  const rewardInvoiceExpired = Boolean(reward?.bolt11 && (reward.status === 'invoice_ready' || reward.status === 'paying') && rewardInvoiceHasValidExpiry && reward.invoiceExpiresAt <= now);
  const rewardInvoiceActive = Boolean(reward?.bolt11 && (reward.status === 'invoice_ready' || reward.status === 'paying') && reward.satsAmount === CONSENSUS_REWARD_SATS && rewardInvoiceHasValidExpiry && reward.invoiceExpiresAt > now);
  const rewardInvoiceHasLegacyAmount = Boolean(reward?.bolt11 && (reward.status === 'invoice_ready' || reward.status === 'paying') && reward.satsAmount !== CONSENSUS_REWARD_SATS);
  const rewardInvoiceExpiryUnavailable = Boolean(reward?.bolt11 && (reward.status === 'invoice_ready' || reward.status === 'paying') && !rewardInvoiceHasValidExpiry);
  const submitInvoice = useMutation((api as any).wavelengthRewards.submitInvoice);
  const { phase, error: walletError } = useWallet();
  const balance = useWalletBalance();
  const create = useWalletCreate();
  const unlock = useWalletUnlock();
  const receive = useWalletReceive();

  useEffect(() => {
    if (!rewardInvoiceActive) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [rewardInvoiceActive]);

  async function openWallet() {
    setError('');
    try {
      if (phase === 'needsWallet') await create.create({ password });
      else if (phase === 'locked') await unlock.unlock({ password });
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  async function claim() {
    setError('');
    try {
      const eligibilityToken = PUBLIC_SHOWCASE.enabled
        ? readEligibilityToken('reward_claim', code)
        : null;
      if (PUBLIC_SHOWCASE.enabled && !eligibilityToken) {
        throw new Error('Return to the booking page and complete the reward check.');
      }
      const result = await receive.receive({ amountSat: CONSENSUS_REWARD_SATS, memo: `OpenStays consensus reward ${receipt.publicId}` });
      await submitInvoice({ confirmationCode: code, email, satsAmount: CONSENSUS_REWARD_SATS,
        bolt11: result.invoice, expiresAt: Date.now() + 10 * 60_000,
        eligibilityToken: eligibilityToken ?? undefined });
      if (PUBLIC_SHOWCASE.enabled) clearEligibilityToken('reward_claim', code);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  return <div className="mx-auto max-w-2xl px-4 py-10">
    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">Consensus Commons · Signet</p>
    <h1 className="mt-2 text-3xl font-semibold text-stone-950">Receive your 1,000-sat consensus reward</h1>
    {PUBLIC_SHOWCASE.enabled ? <FictionalBookingNotice /> : null}
    <p className="mt-3 text-sm text-stone-600">Your wallet is self-custodial and runs only in this browser. OpenStays never receives its password, seed, or keys.</p>
    {!email.includes('@') ? <section className="card mt-6 p-5"><label className="field-label" htmlFor="reward-email">Booking email</label>
      <input id="reward-email" className="field-input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></section> : null}
    {receipt === null ? <p role="alert" className="mt-6 rounded-lg bg-red-50 p-4 text-red-800">Booking or receipt not found.</p> : null}
    {receipt ? <section className="card mt-6 p-5"><div className="flex flex-wrap justify-between gap-3"><h2 className="font-semibold">Timestamped receipt</h2><span className="rounded-full bg-emerald-100 px-3 py-1 text-sm">{receipt.status}</span></div>
      <p className="mt-3 break-all font-mono text-xs text-stone-600">{receipt.sha256}</p><p className="mt-3 text-xs text-stone-500">OpenTimestamps will eventually attest this receipt on Bitcoin mainnet. The reward is signet test sats.</p></section> : null}
    {receipt ? <section className="card mt-5 p-5"><div className="flex justify-between gap-3"><h2 className="font-semibold">Self-custodial wallet</h2><span className="text-sm text-stone-500">{phase}</span></div>
      {(phase === 'needsWallet' || phase === 'locked') ? <div className="mt-4"><label className="field-label" htmlFor="reward-password">Local wallet password</label><input id="reward-password" className="field-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        <button type="button" className="btn-primary mt-3" disabled={!password || create.createPending || unlock.unlockPending} onClick={() => void openWallet()}>{phase === 'needsWallet' ? 'Create wallet' : 'Unlock wallet'}</button></div> : null}
      {phase === 'ready' ? <div className="mt-4"><p className="text-sm text-stone-500">Balance</p><p className="text-2xl font-semibold">{(balance?.confirmedSat ?? 0).toLocaleString()} sats</p>
        {reward === null ? <p role="status" className="mt-4 text-sm text-stone-600">This simulated tour does not include a signet reward.</p> : reward?.status === 'paid' ? <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 font-medium text-emerald-800">Reward paid: consensus reached in both directions.</p> : <button type="button" className="btn-primary mt-4" disabled={!reward || operations?.rewardAvailable !== true || receive.receivePending || reward.status === 'paying' || reward.status === 'invoice_ready'} onClick={() => void claim()}>{receive.receivePending ? 'Creating invoice…' : reward?.status === 'paying' || reward?.status === 'invoice_ready' ? 'Merchant payment in progress…' : `Claim ${CONSENSUS_REWARD_LABEL}`}</button>}
        {reward?.status !== 'paid' && operations && !operations.rewardAvailable ? <p role="status" className="mt-3 text-sm text-amber-800">Reward payout is temporarily unavailable while the merchant bridge or funded budget is unhealthy. Your eligibility remains recorded.</p> : null}</div> : null}
      {rewardInvoiceActive ? <div className="mt-4"><Bolt11Invoice invoice={reward.bolt11} amountSats={reward.satsAmount} expiresAt={reward.invoiceExpiresAt} label="Consensus reward invoice" /></div> : rewardInvoiceExpiryUnavailable ? <p role="status" className="mt-4 text-sm text-stone-600">Invoice expiry is unavailable; QR cannot be shown while awaiting authoritative reconciliation.</p> : rewardInvoiceHasLegacyAmount ? <p role="status" className="mt-4 text-sm text-stone-600">This reward invoice uses a legacy amount and cannot be shown. Wait for authoritative reconciliation.</p> : rewardInvoiceExpired ? <p role="status" className="mt-4 text-sm text-stone-600">Invoice expired; waiting for authoritative reconciliation</p> : null}
      {(error || walletError || create.createError || unlock.unlockError || receive.receiveError) ? <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error || walletError?.message || create.createError?.message || unlock.unlockError?.message || receive.receiveError?.message}</p> : null}
      {create.createData?.mnemonic?.length ? <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4"><p className="font-semibold">Save these recovery words offline</p><p className="mt-2 break-words font-mono text-sm">{create.createData.mnemonic.join(' ')}</p></div> : null}
    </section> : null}
  </div>;
}

export default function ConsensusRewardPage() {
  return <WavelengthProvider engine={wavelengthEngine}><RewardWallet /></WavelengthProvider>;
}
