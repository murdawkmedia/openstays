import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../convex/_generated/api';
import { createWebWalletEngine, defaultConfig } from '@lightninglabs/wavelength-web';
import wavelengthWorkerUrl from '@lightninglabs/wavelength-web/wavewalletdk-worker.js?url';
import { WavelengthProvider, useWallet, useWalletBalance, useWalletCreate, useWalletSend, useWalletUnlock } from '@lightninglabs/wavelength-react';
import { readGuestConfirmation } from '../../shared/bookingLinks';
import { wavelengthRuntimeOptions } from '../lib/wavelengthRuntime';

const wavelengthApi = (api as any).wavelength;
const wavelengthEngine = createWebWalletEngine({
  ...wavelengthRuntimeOptions(window.location.href, wavelengthWorkerUrl),
  config: defaultConfig('signet'),
  autoStart: true,
});

function WalletPayment() {
  const { bookingId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const [confirmationCode] = useState(() => readGuestConfirmation(searchParams));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [started, setStarted] = useState(false);
  const [error, setError] = useState('');
  const createRequest = useMutation(wavelengthApi.createRequest);
  const request = useQuery(wavelengthApi.forGuest, started && email ? { confirmationCode, email } : 'skip') as any;
  const { phase, error: walletError } = useWallet();
  const balance = useWalletBalance();
  const create = useWalletCreate();
  const unlock = useWalletUnlock();
  const send = useWalletSend();

  async function begin() {
    setError('');
    try { await createRequest({ bookingId, confirmationCode, email }); setStarted(true); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
  }
  async function open() {
    if (phase === 'needsWallet') await create.create({ password });
    else if (phase === 'locked') await unlock.unlock({ password });
  }
  async function pay() {
    if (request?.bolt11) await send.send({ invoice: request.bolt11, note: `OpenStays ${confirmationCode}` });
  }

  return <div className="mx-auto max-w-3xl px-4 py-10">
    <div className="mb-8 flex flex-wrap items-center justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">Consensus Commons · Signet</p><h1 className="mt-2 text-3xl font-semibold">Pay with Wavelength</h1></div><span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900">test sats only</span></div>
    {!started ? <section className="card p-6"><label className="field-label" htmlFor="wallet-email">Booking email</label><input id="wallet-email" type="email" className="field-input" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
      <button type="button" className="btn-primary mt-4" disabled={!email || !bookingId || !confirmationCode} onClick={() => void begin()}>Request signet invoice</button>{error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}</section> :
      <div className="space-y-5"><section className="card p-6"><div className="flex justify-between gap-3"><h2 className="font-semibold">Merchant invoice</h2><span className="text-sm">{request?.status ?? 'requesting'}</span></div>
        {request ? <p className="mt-3 text-sm text-stone-600">Fixed demo quote: {request.satsAmount.toLocaleString()} signet sats for {(request.quotedAmountCents / 100).toFixed(2)} {request.currency}.</p> : null}
        {!request?.bolt11 ? <p role="status" className="mt-3 text-sm">Waiting for the local merchant bridge…</p> : null}
        {request?.status === 'settled' ? <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 font-medium text-emerald-800">Consensus reached: the authenticated bridge verified the completed receive.</p> : null}</section>
        <section className="card p-6"><div className="flex justify-between gap-3"><h2 className="font-semibold">Your self-custodial wallet</h2><span className="text-sm">{phase}</span></div>
          {(phase === 'needsWallet' || phase === 'locked') ? <div className="mt-4"><label className="field-label" htmlFor="wallet-password">Local wallet password</label><input id="wallet-password" type="password" className="field-input" value={password} onChange={(event) => setPassword(event.target.value)} />
            <button type="button" className="btn-primary mt-3" disabled={!password || create.createPending || unlock.unlockPending} onClick={() => void open()}>{phase === 'needsWallet' ? 'Create local wallet' : 'Unlock local wallet'}</button></div> : null}
          {phase === 'ready' ? <div className="mt-4"><p className="text-sm text-stone-500">Spendable balance</p><p className="text-2xl font-semibold">{(balance?.confirmedSat ?? 0).toLocaleString()} sats</p><button type="button" className="btn-primary mt-4" disabled={!request?.bolt11 || request.status === 'settled' || send.sendPending} onClick={() => void pay()}>{send.sendPending ? 'Paying…' : `Pay ${request?.satsAmount ?? ''} signet sats`}</button></div> : null}
          {(walletError || create.createError || unlock.unlockError || send.sendError) ? <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{(walletError ?? create.createError ?? unlock.unlockError ?? send.sendError)?.message}</p> : null}
          {create.createData?.mnemonic?.length ? <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4"><p className="font-semibold">Save these recovery words offline</p><p className="mt-2 break-words font-mono text-sm">{create.createData.mnemonic.join(' ')}</p></div> : null}
          <p className="mt-4 text-xs text-stone-500">This wallet runs in your browser. OpenStays never receives its password, recovery words, or keys.</p></section></div>}
  </div>;
}

export default function WavelengthWalletPage() {
  return <WavelengthProvider engine={wavelengthEngine}><WalletPayment /></WavelengthProvider>;
}
