import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { useParams, useSearchParams } from 'react-router-dom';
import { createWebWalletEngine, defaultConfig } from '@lightninglabs/wavelength-web';
import { WavelengthProvider, useWallet, useWalletBalance, useWalletCreate, useWalletReceive, useWalletUnlock } from '@lightninglabs/wavelength-react';
import { api } from '../../convex/_generated/api';

function RewardWallet() {
  const { code = '' } = useParams();
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const auth = code && email.includes('@') ? { confirmationCode: code, email } : 'skip';
  const receipt = useQuery((api as any).consensusReceipts.forGuest, auth) as any;
  const reward = useQuery((api as any).wavelengthRewards.forGuest, auth) as any;
  const submitInvoice = useMutation((api as any).wavelengthRewards.submitInvoice);
  const { phase, error: walletError } = useWallet();
  const balance = useWalletBalance();
  const create = useWalletCreate();
  const unlock = useWalletUnlock();
  const receive = useWalletReceive();

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
      const result = await receive.receive({ amountSat: 210, memo: `OpenStays consensus reward ${receipt.publicId}` });
      await submitInvoice({ confirmationCode: code, email, bolt11: result.invoice, expiresAt: Date.now() + 10 * 60_000 });
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }

  return <main className="mx-auto max-w-2xl px-4 py-10">
    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-700">Consensus Commons · Signet</p>
    <h1 className="mt-2 text-3xl font-semibold text-stone-950">Receive your 210-sat consensus reward</h1>
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
        {reward?.status === 'paid' ? <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 font-medium text-emerald-800">Reward paid: consensus reached in both directions.</p> : <button type="button" className="btn-primary mt-4" disabled={!reward || receive.receivePending || reward.status === 'paying' || reward.status === 'invoice_ready'} onClick={() => void claim()}>{receive.receivePending ? 'Creating invoice…' : reward?.status === 'paying' || reward?.status === 'invoice_ready' ? 'Merchant payment in progress…' : 'Claim 210 signet sats'}</button>}</div> : null}
      {(error || walletError || create.createError || unlock.unlockError || receive.receiveError) ? <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error || walletError?.message || create.createError?.message || unlock.unlockError?.message || receive.receiveError?.message}</p> : null}
      {create.createData?.mnemonic?.length ? <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4"><p className="font-semibold">Save these recovery words offline</p><p className="mt-2 break-words font-mono text-sm">{create.createData.mnemonic.join(' ')}</p></div> : null}
    </section> : null}
  </main>;
}

export default function ConsensusRewardPage() {
  const [engine] = useState(() => createWebWalletEngine({ runtimeBaseUrl: new URL('wavewalletdk/', document.baseURI).toString(), config: defaultConfig('signet'), autoStart: true }));
  return <WavelengthProvider engine={engine}><RewardWallet /></WavelengthProvider>;
}
