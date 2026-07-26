import { useEffect, useRef, useState } from 'react';
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
  useWalletReceive,
  useWalletRefresh,
  useWalletSend,
  useWalletUnlock,
} from '@lightninglabs/wavelength-react';
import { readGuestConfirmation } from '../../shared/bookingLinks';
import { Bolt11Invoice } from '../components/Bolt11Invoice';
import { wavelengthRuntimeOptions } from '../lib/wavelengthRuntime';
import {
  shouldAutoRefreshWavelengthBalance,
  WAVELENGTH_BALANCE_REFRESH_INTERVAL_MS,
} from '../lib/wavelengthBalanceRefresh';
import {
  canConfirmPreparedPayment,
  explainWavelengthError,
  WAVELENGTH_BOOKING_MAX_FEE_SATS,
  validateBookingQuote,
} from '../lib/wavelengthPayment';
import {
  DEMO_WALLET_TARGET_ATTEMPTS,
  DEMO_WALLET_TARGET_SATS,
  demoWalletAttemptsFunded,
  isLocalDemoWalletSetup,
} from '../lib/wavelengthDemoWallet';

const wavelengthApi = (api as any).wavelength;
const DEMO_FUNDING_DISPLAY_WINDOW_MS = 10 * 60_000;
const wavelengthEngine = createWebWalletEngine({
  ...wavelengthRuntimeOptions(window.location.href, wavelengthWorkerUrl),
  config: defaultConfig('signet'),
  autoStart: true,
});

function WalletPayment() {
  const { bookingId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const demoSetup = isLocalDemoWalletSetup(window.location.hostname, searchParams.get('demoSetup'));
  const [confirmationCode] = useState(() => readGuestConfirmation(searchParams));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [started, setStarted] = useState(false);
  const [error, setError] = useState('');
  const [recoveryRevealed, setRecoveryRevealed] = useState(false);
  const [recoverySaved, setRecoverySaved] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => document.visibilityState === 'visible');
  const [lastBalanceCheckAt, setLastBalanceCheckAt] = useState<number>();
  const [autoRefreshStopped, setAutoRefreshStopped] = useState(false);
  const [demoFundingInvoice, setDemoFundingInvoice] = useState('');
  const [demoFundingDisplayDeadline, setDemoFundingDisplayDeadline] = useState<number>();
  const [now, setNow] = useState(() => Date.now());
  const refreshInFlight = useRef(false);
  const createRequest = useMutation(wavelengthApi.createRequest);
  const request = useQuery(
    wavelengthApi.forGuest,
    started && email ? { confirmationCode, email } : 'skip',
  ) as any;
  const bookingInvoiceActive = Boolean(request?.bolt11 && request.status === 'invoice_ready' && request.expiresAt > now);
  const bookingInvoiceExpired = Boolean(request?.bolt11 && request.status === 'invoice_ready' && request.expiresAt <= now);
  const demoFundingInvoiceActive = Boolean(demoFundingInvoice && demoFundingDisplayDeadline && demoFundingDisplayDeadline > now);
  const { phase, error: walletError } = useWallet();
  const balance = useWalletBalance();
  const create = useWalletCreate();
  const unlock = useWalletUnlock();
  const deposit = useWalletDeposit();
  const prepare = useWalletPrepareSend();
  const receive = useWalletReceive();
  const refresh = useWalletRefresh();
  const send = useWalletSend();
  const spendableSats = balance?.confirmedSat ?? 0;
  const pendingInSat = balance?.pendingInSat ?? 0;
  const inboundAutoRefreshActive = shouldAutoRefreshWavelengthBalance({
    walletPhase: phase,
    pendingInSat,
    pageVisible,
    refreshPending: refresh.refreshPending || autoRefreshStopped,
  });
  const demoAutoRefreshActive = demoSetup && Boolean(demoFundingInvoice) &&
    phase === 'ready' && spendableSats < DEMO_WALLET_TARGET_SATS &&
    pageVisible && !refresh.refreshPending && !autoRefreshStopped;
  const autoRefreshActive = inboundAutoRefreshActive || demoAutoRefreshActive;
  const fundedDemoAttempts = Math.min(
    DEMO_WALLET_TARGET_ATTEMPTS,
    demoWalletAttemptsFunded(spendableSats),
  );

  useEffect(() => {
    prepare.resetPrepare();
    send.resetSend();
  }, [request?._id, request?.status]);

  useEffect(() => {
    if (!bookingInvoiceActive) prepare.resetPrepare();
  }, [bookingInvoiceActive]);

  useEffect(() => {
    const updateVisibility = () => setPageVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', updateVisibility);
    return () => document.removeEventListener('visibilitychange', updateVisibility);
  }, []);

  useEffect(() => {
    if (!autoRefreshActive) return;
    const interval = window.setInterval(() => {
      void refreshBalance('automatic');
    }, WAVELENGTH_BALANCE_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [autoRefreshActive]);

  useEffect(() => {
    if (!bookingInvoiceActive && !demoFundingInvoiceActive) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [bookingInvoiceActive, demoFundingInvoiceActive]);

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
    if (!bookingInvoiceActive || !request?.bolt11) return;
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

  async function createDemoFundingInvoice() {
    setError('');
    try {
      const result = await receive.receive({
        amountSat: DEMO_WALLET_TARGET_SATS,
        memo: 'OpenStays judge demo wallet preflight',
      });
      setDemoFundingInvoice(result.invoice);
      setDemoFundingDisplayDeadline(Date.now() + DEMO_FUNDING_DISPLAY_WINDOW_MS);
    } catch (err) {
      setError(explainWavelengthError(err));
    }
  }

  async function refreshBalance(source: 'automatic' | 'manual' = 'manual') {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    if (source === 'manual') {
      setError('');
      setAutoRefreshStopped(false);
    }
    try {
      await refresh.refresh();
      setLastBalanceCheckAt(Date.now());
      setAutoRefreshStopped(false);
    } catch (err) {
      if (source === 'automatic') setAutoRefreshStopped(true);
      setError(explainWavelengthError(err));
    } finally {
      refreshInFlight.current = false;
    }
  }

  const displayError = error || (walletError || create.createError || unlock.unlockError ||
    deposit.depositError || prepare.prepareError || receive.receiveError ||
    refresh.refreshError || send.sendError
    ? explainWavelengthError(
      walletError ?? create.createError ?? unlock.unlockError ??
      deposit.depositError ?? prepare.prepareError ?? receive.receiveError ??
      refresh.refreshError ?? send.sendError,
    )
    : '');

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-700">Consensus Commons · Signet</p>
          <h1 className="mt-2 text-3xl font-semibold">
            {demoSetup ? 'Prepare demo wallet' : 'Pay with Wavelength'}
          </h1>
        </div>
        <span className="rounded-full bg-amber-100 px-3 py-1 text-sm font-medium text-amber-900">test sats only</span>
      </div>

      {!demoSetup && !started ? (
        <section className="card p-6">
          <label className="field-label" htmlFor="wallet-email">Booking email</label>
          <input id="wallet-email" type="email" className="field-input" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
          <button type="button" className="btn-primary mt-4" disabled={!email || !bookingId || !confirmationCode} onClick={() => void begin()}>Request signet invoice</button>
          {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
        </section>
      ) : (
        <div className="space-y-5">
          {!demoSetup ? <section className="card p-6">
            <div className="flex justify-between gap-3"><h2 className="font-semibold">Merchant invoice</h2><span className="text-sm">{request?.status ?? 'requesting'}</span></div>
            {request ? <p className="mt-3 text-sm text-stone-600">Fixed demo quote: {request.satsAmount.toLocaleString()} signet sats for {(request.quotedAmountCents / 100).toFixed(2)} {request.currency}.</p> : null}
            {!request?.bolt11 ? <p role="status" className="mt-3 text-sm">Waiting for the local merchant bridge…</p> : null}
            {bookingInvoiceActive ? <div className="mt-4"><Bolt11Invoice invoice={request.bolt11} amountSats={request.satsAmount} expiresAt={request.expiresAt} label="Booking invoice" /></div> : null}
            {bookingInvoiceExpired ? <p role="status" className="mt-4 text-sm text-stone-600">Invoice expired; waiting for authoritative reconciliation</p> : null}
            {request?.status === 'failed' || request?.status === 'expired' ? (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm text-amber-950">The merchant retired that invoice after authoritative reconciliation. It is safe to request a fresh one.</p>
                <button type="button" className="btn-secondary mt-3" onClick={() => void begin()}>Request fresh invoice</button>
              </div>
            ) : null}
            {request?.status === 'settled' ? <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 font-medium text-emerald-800">Consensus reached: the authenticated bridge verified the completed receive.</p> : null}
          </section> : (
            <section className="card p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-semibold">Local judge-demo preflight</h2>
                <span className="rounded-full bg-stone-100 px-3 py-1 text-sm text-stone-700">
                  {fundedDemoAttempts} / {DEMO_WALLET_TARGET_ATTEMPTS} attempts funded
                </span>
              </div>
              {spendableSats >= DEMO_WALLET_TARGET_SATS ? (
                <div role="status" className="mt-4 rounded-xl bg-emerald-50 p-4 text-emerald-900">
                  <p className="font-semibold">Demo wallet ready</p>
                  <p className="mt-1 text-sm">12 judge attempts are backed by spendable Signet sats.</p>
                </div>
              ) : (
                <p className="mt-3 text-sm text-stone-600">
                  Prepare one real 12,000-sat Signet balance before judging. This control only works on localhost.
                </p>
              )}
            </section>
          )}

          <section className="card p-6">
            <div className="flex justify-between gap-3"><h2 className="font-semibold">Your self-custodial wallet</h2><span className="text-sm">{phase}</span></div>
            {phase === 'error' ? (
              <div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
                <p className="font-medium">This browser wallet is already open elsewhere</p>
                <p className="mt-1 text-sm">Close any other OpenStays wallet tab, then reload this payment page. Your wallet and booking remain safe.</p>
                <button type="button" className="btn-secondary mt-3" onClick={() => window.location.reload()}>Reload wallet in this tab</button>
              </div>
            ) : null}
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
                {pendingInSat > 0 ? (
                  <div role="status" aria-live="polite" className="mt-2 text-sm font-medium text-sky-900">
                    <p>Pending inbound: {pendingInSat.toLocaleString()} sats. Waiting for boarding to complete.</p>
                    <p className="mt-1 font-normal">
                      {autoRefreshStopped
                        ? 'Automatic checks paused after an error; use the refresh button to retry.'
                        : pageVisible
                          ? 'Checking automatically every 12 seconds.'
                          : 'Automatic checks pause while this tab is hidden.'}
                      {lastBalanceCheckAt ? ` Last checked ${new Date(lastBalanceCheckAt).toLocaleTimeString()}.` : ''}
                    </p>
                  </div>
                ) : null}
                <button type="button" className="btn-secondary mt-3" disabled={refresh.refreshPending} onClick={() => void refreshBalance('manual')}>
                  {refresh.refreshPending ? 'Refreshing…' : 'Refresh wallet balance'}
                </button>
                {demoSetup && spendableSats < DEMO_WALLET_TARGET_SATS ? (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                    <p className="font-medium text-amber-950">One-time Lightning funding</p>
                    <p className="mt-1 text-sm text-amber-900">
                      Create one amount-bearing invoice. The local operator validates and pays it once; this page never auto-pays.
                    </p>
                    {!demoFundingInvoice ? (
                      <button
                        type="button"
                        className="btn-primary mt-3"
                        disabled={receive.receivePending}
                        onClick={() => void createDemoFundingInvoice()}
                      >
                        {receive.receivePending ? 'Creating invoice…' : 'Create 12,000-sat funding invoice'}
                      </button>
                    ) : demoFundingInvoiceActive ? (
                      <div className="mt-3">
                        <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">Merchant funding invoice</p>
                        <div className="mt-2"><Bolt11Invoice invoice={demoFundingInvoice} amountSats={DEMO_WALLET_TARGET_SATS} label="Demo wallet funding invoice" /></div>
                        <p role="status" className="mt-2 text-sm text-amber-900">
                          Waiting for the verified merchant send and spendable wallet balance.
                        </p>
                      </div>
                    ) : (
                      <p role="status" className="mt-3 text-sm text-amber-900">Setup window ended. Confirm no merchant send or inbound activity before reloading to create a replacement.</p>
                    )}
                  </div>
                ) : null}
                {!demoSetup && spendableSats < (request?.satsAmount ?? 1) ? (
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

                {!demoSetup && bookingInvoiceActive && prepare.prepareData && !send.sendData ? (
                  <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                    <p className="font-medium text-emerald-950">Payment prepared</p>
                    <p className="mt-1 text-sm text-emerald-900">{prepare.prepareData.amountSat.toLocaleString()} sats + {prepare.prepareData.expectedFeeSat.toLocaleString()} sat estimated fee via {prepare.prepareData.rail.replaceAll('_', ' ')}.</p>
                    <button type="button" className="btn-primary mt-3" disabled={!canConfirmPreparedPayment(request?.status, true, Boolean(send.sendData), send.sendPending)} onClick={() => void pay()}>{send.sendPending ? 'Paying…' : `Confirm ${request?.satsAmount.toLocaleString()} sat payment`}</button>
                  </div>
                ) : !demoSetup && bookingInvoiceActive && !send.sendData ? (
                  <button type="button" className="btn-primary mt-4" disabled={!request?.bolt11 || request.status !== 'invoice_ready' || prepare.preparePending || spendableSats < (request?.satsAmount ?? 1)} onClick={() => void preparePayment()}>{prepare.preparePending ? 'Preparing…' : `Review ${request?.satsAmount ?? ''} sat payment`}</button>
                ) : null}
                {!demoSetup && send.sendData && request?.status !== 'settled' ? <p role="status" className="mt-4 rounded-xl bg-sky-50 p-3 text-sm text-sky-900">Payment dispatched. The authenticated merchant bridge is verifying settlement…</p> : null}
              </div>
            ) : null}

            {phase !== 'error' && displayError ? <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{displayError}</p> : null}
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
