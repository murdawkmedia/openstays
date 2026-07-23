import { useEffect, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../convex/_generated/api';
import { createWebWalletEngine, defaultConfig } from '@lightninglabs/wavelength-web';
import wavelengthWorkerUrl from '@lightninglabs/wavelength-web/wavewalletdk-worker.js?url';
import {
  WavelengthProvider,
  useWallet,
  useWalletBalance,
  useWalletCreate,
  useWalletDeposit,
  useWalletPrepareSend,
  useWalletRefresh,
  useWalletSend,
  useWalletUnlock,
} from '@lightninglabs/wavelength-react';
import { readGuestConfirmation } from '../../shared/bookingLinks';
import { wavelengthRuntimeOptions } from '../lib/wavelengthRuntime';
import {
  canConfirmPreparedPayment,
  explainWavelengthError,
  WAVELENGTH_BOOKING_MAX_FEE_SATS,
  validateBookingQuote,
} from '../lib/wavelengthPayment';

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
  const [recoveryRevealed, setRecoveryRevealed] = useState(false);
  const [recoverySaved, setRecoverySaved] = useState(false);
  const createRequest = useMutation(wavelengthApi.createRequest);
  const request = useQuery(
    wavelengthApi.forGuest,
    started && email ? { confirmationCode, email } : 'skip',
  ) as any;
  const { phase, error: walletError } = useWallet();
  const balance = useWalletBalance();
  const create = useWalletCreate();
  const unlock = useWalletUnlock();
  const deposit = useWalletDeposit();
  const prepare = useWalletPrepareSend();
  const refresh = useWalletRefresh();
  const send = useWalletSend();
  const spendableSats = balance?.confirmedSat ?? 0;

  useEffect(() => {
    prepare.resetPrepare();
    send.resetSend();
  }, [request?._id, request?.status]);

  async function begin() {
    setError('');
    try {
      await createRequest({ bookingId, confirmationCode, email });
      setStarted(true);
    } catch (err) {
      setError(explainWavelengthError(err));
    }
  }

  async function open() {
    setError('');
    try {
      if (phase === 'needsWallet') await create.create({ password });
      else if (phase === 'locked') await unlock.unlock({ password });
    } catch (err) {
      setError(explainWavelengthError(err));
    }
  }

  async function preparePayment() {
    if (!request?.bolt11) return;
    setError('');
    prepare.resetPrepare();
    send.resetSend();
    try {
      const quote = await prepare.prepare({
        invoice: request.bolt11,
        note: `OpenStays ${confirmationCode}`,
        maxFeeSat: WAVELENGTH_BOOKING_MAX_FEE_SATS,
      });
      const validation = validateBookingQuote(quote, request.satsAmount, Date.now());
      if (!validation.ok) {
        prepare.resetPrepare();
        setError(validation.message);
      }
    } catch (err) {
      setError(explainWavelengthError(err));
    }
  }

  async function pay() {
    if (
      !request ||
      !prepare.prepareData ||
      !canConfirmPreparedPayment(
        request.status,
        true,
        Boolean(send.sendData),
        send.sendPending,
      )
    ) return;
    const validation = validateBookingQuote(prepare.prepareData, request.satsAmount, Date.now());
    if (!validation.ok) {
      prepare.resetPrepare();
      setError(validation.message);
      return;
    }
    setError('');
    try {
      await send.sendPrepared(prepare.prepareData);
    } catch (err) {
      prepare.resetPrepare();
      setError(explainWavelengthError(err));
    }
  }

  async function createDepositAddress() {
    setError('');
    try {
      await deposit.deposit({ amountSatHint: 2_500 });
    } catch (err) {
      setError(explainWavelengthError(err));
    }
  }

  async function refreshBalance() {
    setError('');
    try {
      await refresh.refresh();
    } catch (err) {
      setError(explainWavelengthError(err));
    }
  }

  const displayError = error || (walletError || create.createError || unlock.unlockError ||
    deposit.depositError || prepare.prepareError || refresh.refreshError || send.sendError
    ? explainWavelengthError(
      walletError ?? create.createError ?? unlock.unlockError ??
      deposit.depositError ?? prepare.prepareError ?? refresh.refreshError ?? send.sendError,
    )
    : '');

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">Consensus Commons · Signet</p>
          <h1 className="mt-2 text-3xl font-semibold">Pay with Wavelength</h1>
        </div>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900">test sats only</span>
      </div>

      {!started ? (
        <section className="card p-6">
          <label className="field-label" htmlFor="wallet-email">Booking email</label>
          <input id="wallet-email" type="email" className="field-input" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
          <button type="button" className="btn-primary mt-4" disabled={!email || !bookingId || !confirmationCode} onClick={() => void begin()}>Request signet invoice</button>
          {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
        </section>
      ) : (
        <div className="space-y-5">
          <section className="card p-6">
            <div className="flex justify-between gap-3"><h2 className="font-semibold">Merchant invoice</h2><span className="text-sm">{request?.status ?? 'requesting'}</span></div>
            {request ? <p className="mt-3 text-sm text-stone-600">Fixed demo quote: {request.satsAmount.toLocaleString()} signet sats for {(request.quotedAmountCents / 100).toFixed(2)} {request.currency}.</p> : null}
            {!request?.bolt11 ? <p role="status" className="mt-3 text-sm">Waiting for the local merchant bridge…</p> : null}
            {request?.status === 'failed' || request?.status === 'expired' ? (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm text-amber-950">The merchant retired that invoice after authoritative reconciliation. It is safe to request a fresh one.</p>
                <button type="button" className="btn-secondary mt-3" onClick={() => void begin()}>Request fresh invoice</button>
              </div>
            ) : null}
            {request?.status === 'settled' ? <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 font-medium text-emerald-800">Consensus reached: the authenticated bridge verified the completed receive.</p> : null}
          </section>

          <section className="card p-6">
            <div className="flex justify-between gap-3"><h2 className="font-semibold">Your self-custodial wallet</h2><span className="text-sm">{phase}</span></div>
            {phase === 'needsWallet' || phase === 'locked' ? (
              <div className="mt-4">
                <label className="field-label" htmlFor="wallet-password">Local wallet password</label>
                <input id="wallet-password" type="password" className="field-input" value={password} onChange={(event) => setPassword(event.target.value)} />
                <button type="button" className="btn-primary mt-3" disabled={!password || create.createPending || unlock.unlockPending} onClick={() => void open()}>{phase === 'needsWallet' ? 'Create local wallet' : 'Unlock local wallet'}</button>
              </div>
            ) : null}

            {phase === 'ready' ? (
              <div className="mt-4">
                <p className="text-sm text-stone-500">Spendable balance</p>
                <p className="text-2xl font-semibold">{spendableSats.toLocaleString()} sats</p>
                {(balance?.pendingInSat ?? 0) > 0 ? (
                  <p role="status" className="mt-2 text-sm font-medium text-sky-900">
                    Pending inbound: {balance?.pendingInSat.toLocaleString()} sats. Waiting for boarding to complete.
                  </p>
                ) : null}
                <button type="button" className="btn-secondary mt-3" disabled={refresh.refreshPending} onClick={() => void refreshBalance()}>
                  {refresh.refreshPending ? 'Refreshing…' : 'Refresh wallet balance'}
                </button>
                {spendableSats < (request?.satsAmount ?? 1) ? (
                  <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-4">
                    <p className="font-medium text-sky-950">Fund this wallet before paying</p>
                    <p className="mt-1 text-sm text-sky-900">Create a tracked signet deposit address, then use test funds only. Boarding funds may need confirmations before they become spendable.</p>
                    {!deposit.depositData ? (
                      <button type="button" className="btn-secondary mt-3" disabled={deposit.depositPending} onClick={() => void createDepositAddress()}>{deposit.depositPending ? 'Creating address…' : 'Create signet deposit address'}</button>
                    ) : (
                      <div className="mt-3">
                        <p className="break-all rounded-lg bg-white p-3 font-mono text-xs">{deposit.depositData.address}</p>
                        <a className="mt-3 inline-flex text-sm font-semibold text-sky-900 underline underline-offset-4" href="https://bitcoinsignetfaucet.com/" target="_blank" rel="noreferrer">Open third-party Signet Faucet guide ↗</a>
                      </div>
                    )}
                  </div>
                ) : null}

                {prepare.prepareData && request?.status === 'invoice_ready' && !send.sendData ? (
                  <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <p className="font-medium text-emerald-950">Payment prepared</p>
                    <p className="mt-1 text-sm text-emerald-900">{prepare.prepareData.amountSat.toLocaleString()} sats + {prepare.prepareData.expectedFeeSat.toLocaleString()} sat estimated fee via {prepare.prepareData.rail.replaceAll('_', ' ')}.</p>
                    <button type="button" className="btn-primary mt-3" disabled={!canConfirmPreparedPayment(request?.status, true, Boolean(send.sendData), send.sendPending)} onClick={() => void pay()}>{send.sendPending ? 'Paying…' : `Confirm ${request?.satsAmount.toLocaleString()} sat payment`}</button>
                  </div>
                ) : !send.sendData && request?.status === 'invoice_ready' ? (
                  <button type="button" className="btn-primary mt-4" disabled={!request?.bolt11 || request.status !== 'invoice_ready' || prepare.preparePending || spendableSats < (request?.satsAmount ?? 1)} onClick={() => void preparePayment()}>{prepare.preparePending ? 'Preparing…' : `Review ${request?.satsAmount ?? ''} sat payment`}</button>
                ) : null}
                {send.sendData && request?.status !== 'settled' ? <p role="status" className="mt-4 rounded-xl bg-sky-50 p-3 text-sm text-sky-900">Payment dispatched. The authenticated merchant bridge is verifying settlement…</p> : null}
              </div>
            ) : null}

            {displayError ? <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{displayError}</p> : null}
            {create.createData?.mnemonic?.length && !recoverySaved ? (
              <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
                <p className="font-semibold">Save the wallet recovery words privately</p>
                <p className="mt-1 text-sm text-amber-900">They are hidden by default so they cannot accidentally appear during a public demo.</p>
                {recoveryRevealed ? (
                  <>
                    <p className="mt-3 break-words rounded-lg bg-white p-3 font-mono text-sm">{create.createData.mnemonic.join(' ')}</p>
                    <button type="button" className="btn-secondary mt-3" onClick={() => { setRecoverySaved(true); setRecoveryRevealed(false); }}>I saved them offline</button>
                  </>
                ) : <button type="button" className="btn-secondary mt-3" onClick={() => setRecoveryRevealed(true)}>Reveal recovery words</button>}
              </div>
            ) : null}
            <p className="mt-4 text-xs text-stone-500">This wallet runs in your browser. OpenStays never receives its password, recovery words, or keys.</p>
          </section>
        </div>
      )}
    </div>
  );
}

export default function WavelengthWalletPage() {
  return <WavelengthProvider engine={wavelengthEngine}><WalletPayment /></WavelengthProvider>;
}
