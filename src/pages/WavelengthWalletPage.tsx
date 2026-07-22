import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../convex/_generated/api';
import { createWebWalletEngine, defaultConfig } from '@lightninglabs/wavelength-web';
import {
  WavelengthProvider,
  useWallet,
  useWalletBalance,
  useWalletCreate,
  useWalletSend,
  useWalletUnlock,
} from '@lightninglabs/wavelength-react';

const wavelengthApi = (api as any).wavelength;

type MainnetRequest = {
  network: 'mainnet';
  status: string;
  satsAmount: number;
  quotedAmountCents: number;
  currency: string;
  expiresAt: number;
  bolt11?: string;
};

export function MainnetInvoice({ request }: { request: MainnetRequest }) {
  const [copied, setCopied] = useState(false);

  async function copyInvoice() {
    if (!request.bolt11) return;
    await navigator.clipboard.writeText(request.bolt11);
    setCopied(true);
  }

  return (
    <section className="rounded-2xl border-2 border-red-300 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">REAL BITCOIN merchant invoice</h2>
        <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-900">MAINNET</span>
      </div>
      <p className="mt-3 text-2xl font-semibold">{request.satsAmount.toLocaleString()} sats</p>
      <p className="mt-1 text-sm text-slate-600">
        Fixed hackathon peg: {(request.quotedAmountCents / 100).toFixed(2)} {request.currency}. This is not a live exchange quote.
      </p>
      {!request.bolt11 ? (
        <p role="status" className="mt-4 text-sm text-slate-600">Waiting for the local merchant bridge to publish the invoice…</p>
      ) : (
        <div className="mt-4">
          <p className="text-sm font-medium text-slate-800">Pay this BOLT11 invoice from a separate Lightning wallet</p>
          <code className="mt-2 block max-h-32 overflow-auto break-all rounded-lg bg-slate-950 p-3 text-xs text-white">
            {request.bolt11}
          </code>
          <button type="button" onClick={copyInvoice} className="mt-3 rounded-lg bg-slate-950 px-4 py-2 font-medium text-white">
            {copied ? 'Invoice copied' : 'Copy Lightning invoice'}
          </button>
          <p className="mt-2 text-xs text-slate-500">Expires {new Date(request.expiresAt).toLocaleString()}.</p>
        </div>
      )}
      {request.status === 'settled' && (
        <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 font-medium text-emerald-800">
          Consensus reached: the authenticated merchant bridge verified exactly 210 sats.
        </p>
      )}
    </section>
  );
}

function MainnetPayment() {
  const { bookingId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const confirmationCode = searchParams.get('code') ?? '';
  const [email, setEmail] = useState('');
  const [requestStarted, setRequestStarted] = useState(false);
  const [requestError, setRequestError] = useState('');
  const createRequest = useMutation(wavelengthApi.createRequest);
  const request = useQuery(
    wavelengthApi.forGuest,
    requestStarted && email ? { confirmationCode, email } : 'skip',
  ) as MainnetRequest | null | undefined;

  async function beginPayment() {
    setRequestError('');
    try {
      await createRequest({ bookingId, confirmationCode, email });
      setRequestStarted(true);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-red-700">Consensus Commons · real-sat demo</p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-950">Pay 210 sats over Lightning</h1>
        </div>
        <span className="rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-900">REAL SATS</span>
      </div>
      {!requestStarted ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <label className="block text-sm font-medium text-slate-800" htmlFor="mainnet-email">Booking email</label>
          <input id="mainnet-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2" autoComplete="email" />
          <button type="button" onClick={beginPayment} disabled={!email || !bookingId || !confirmationCode}
            className="mt-4 rounded-lg bg-red-700 px-4 py-2 font-medium text-white disabled:opacity-40">
            Request real 210-sat invoice
          </button>
          <p className="mt-3 text-xs text-slate-500">This creates an invoice but never pays it automatically.</p>
          {requestError && <p role="alert" className="mt-3 text-sm text-red-700">{requestError}</p>}
        </section>
      ) : request ? <MainnetInvoice request={request} /> : (
        <p role="status" className="rounded-lg bg-slate-100 p-4">Preparing the fixed 210-sat request…</p>
      )}
    </main>
  );
}

function WalletPayment() {
  const { bookingId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const confirmationCode = searchParams.get('code') ?? '';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [requestStarted, setRequestStarted] = useState(false);
  const [requestError, setRequestError] = useState('');
  const createRequest = useMutation(wavelengthApi.createRequest);
  const request = useQuery(
    wavelengthApi.forGuest,
    requestStarted && email ? { confirmationCode, email } : 'skip',
  );
  const { phase, error: walletError } = useWallet();
  const balance = useWalletBalance();
  const walletCreate = useWalletCreate();
  const walletUnlock = useWalletUnlock();
  const walletSend = useWalletSend();

  async function beginPayment() {
    setRequestError('');
    try {
      await createRequest({ bookingId, confirmationCode, email });
      setRequestStarted(true);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : String(error));
    }
  }

  async function openWallet() {
    if (phase === 'needsWallet') await walletCreate.create({ password });
    else if (phase === 'locked') await walletUnlock.unlock({ password });
  }

  async function payInvoice() {
    if (!request?.bolt11) return;
    await walletSend.send({ invoice: request.bolt11, note: `OpenStays ${confirmationCode}` });
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-600">Consensus Commons · Signet demo</p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-950">Pay with your Wavelength wallet</h1>
        </div>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900">test sats only</span>
      </div>

      {!requestStarted && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <label className="block text-sm font-medium text-slate-800" htmlFor="wallet-email">Booking email</label>
          <input
            id="wallet-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2"
            autoComplete="email"
          />
          <button type="button" onClick={beginPayment} disabled={!email || !bookingId || !confirmationCode}
            className="mt-4 rounded-lg bg-slate-950 px-4 py-2 font-medium text-white disabled:opacity-40">
            Request signet invoice
          </button>
          {requestError && <p role="alert" className="mt-3 text-sm text-red-700">{requestError}</p>}
        </section>
      )}

      {requestStarted && (
        <div className="space-y-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Merchant invoice</h2>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-sm">{request?.status ?? 'requesting'}</span>
            </div>
            {request && <p className="mt-3 text-sm text-slate-600">Fixed demo quote: {request.satsAmount.toLocaleString()} sats for {(request.quotedAmountCents / 100).toFixed(2)} {request.currency}.</p>}
            {!request?.bolt11 && <p className="mt-3 text-sm text-slate-600">Waiting for the local merchant bridge to publish an invoice…</p>}
            {request?.status === 'settled' && <p className="mt-4 rounded-lg bg-emerald-50 p-3 font-medium text-emerald-800">Consensus reached: the merchant bridge verified the completed receive.</p>}
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">Your self-custodial wallet</h2>
              <span className="text-sm text-slate-600">{phase}</span>
            </div>
            {(phase === 'needsWallet' || phase === 'locked') && (
              <div className="mt-4">
                <label className="block text-sm font-medium" htmlFor="wallet-password">Local wallet password</label>
                <input id="wallet-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2" autoComplete="current-password" />
                <button type="button" onClick={openWallet} disabled={!password || walletCreate.createPending || walletUnlock.unlockPending}
                  className="mt-3 rounded-lg bg-amber-500 px-4 py-2 font-semibold text-slate-950 disabled:opacity-40">
                  {phase === 'needsWallet' ? 'Create local wallet' : 'Unlock local wallet'}
                </button>
              </div>
            )}
            {phase === 'ready' && (
              <div className="mt-4">
                <p className="text-sm text-slate-600">Spendable balance</p>
                <p className="text-2xl font-semibold">{(balance?.confirmedSat ?? 0).toLocaleString()} sats</p>
                <button type="button" onClick={payInvoice} disabled={!request?.bolt11 || request.status === 'settled' || walletSend.sendPending}
                  className="mt-4 rounded-lg bg-amber-500 px-5 py-3 font-semibold text-slate-950 disabled:opacity-40">
                  {walletSend.sendPending ? 'Paying…' : `Pay ${request?.satsAmount?.toLocaleString() ?? ''} sats`}
                </button>
              </div>
            )}
            {(walletError || walletCreate.createError || walletUnlock.unlockError || walletSend.sendError) && (
              <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                {(walletError ?? walletCreate.createError ?? walletUnlock.unlockError ?? walletSend.sendError)?.message}
              </p>
            )}
            {walletCreate.createData?.mnemonic && walletCreate.createData.mnemonic.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
                <p className="font-semibold">Save these recovery words offline</p>
                <p className="mt-2 break-words font-mono text-sm">{walletCreate.createData.mnemonic.join(' ')}</p>
              </div>
            )}
            <p className="mt-4 text-xs text-slate-500">The wallet runs in this browser. OpenStays never receives your password, recovery words, or wallet keys.</p>
          </section>
        </div>
      )}
    </main>
  );
}

export default function WavelengthWalletPage() {
  const info = useQuery(wavelengthApi.available) as { network?: 'signet' | 'mainnet' } | undefined;
  if (!info) return <main className="mx-auto max-w-3xl px-4 py-10"><p role="status">Loading payment network…</p></main>;
  if (info.network === 'mainnet') return <MainnetPayment />;
  return <SignetWalletPage />;
}

function SignetWalletPage() {
  const [engine] = useState(() => createWebWalletEngine({
    runtimeBaseUrl: new URL('wavewalletdk/', document.baseURI).toString(),
    config: defaultConfig('signet'),
    autoStart: true,
  }));
  return <WavelengthProvider engine={engine}><WalletPayment /></WavelengthProvider>;
}
