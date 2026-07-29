import { ConsensusReceiptInspector } from './ConsensusReceiptInspector';

type Receipt = {
  publicId: string;
  status: string;
  sha256: string;
  canonicalJson: string;
  schemaVersion: string;
  calendarCount?: number;
  bitcoinBlockHeight?: number;
  bitcoinBlockTime?: number;
  proofBase64?: string;
};
type Reward = { status: string; satsAmount: number } | null;

export function ConsensusReceiptSummary({ receipt, reward, rewardUrl, onDownloadJson, onDownloadProof, onClaimReward, claimAvailable = true }: {
  receipt: Receipt; reward: Reward; rewardUrl: string; onDownloadJson: () => void; onDownloadProof: () => void;
  onClaimReward?: () => void;
  claimAvailable?: boolean;
}) {
  const submitted = receipt.status === 'submitted' || receipt.status === 'bitcoin_anchored';
  const anchored = receipt.status === 'bitcoin_anchored';
  const rewardLabel = `${(reward?.satsAmount ?? 1_000).toLocaleString('en-CA')} signet sats`;
  return <section className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5" aria-labelledby="receipt-heading">
    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Open proof</p>
    <h2 id="receipt-heading" className="mt-1 text-lg font-semibold text-stone-900">Consensus Receipt</h2>
    <p role="status" className="mt-3 font-medium text-stone-800">
      {anchored ? `Bitcoin anchored at block ${receipt.bitcoinBlockHeight}` : submitted ? 'Timestamp submitted' : receipt.status === 'failed' ? 'Timestamp needs attention' : 'Preparing timestamp proof'}
    </p>
    {submitted && !anchored ? <p className="mt-1 text-sm text-amber-800">Bitcoin anchoring pending. Calendar submission already proves the receipt is queued for aggregation.</p> : null}
    <dl className="mt-4 space-y-2 text-xs text-stone-600">
      <div><dt className="font-semibold">Receipt</dt><dd className="break-all font-mono">{receipt.publicId}</dd></div>
      <div><dt className="font-semibold">SHA-256 commitment</dt><dd className="break-all font-mono">{receipt.sha256}</dd></div>
      {receipt.calendarCount ? <div><dt className="font-semibold">Calendars</dt><dd>{receipt.calendarCount} accepted attestation{receipt.calendarCount === 1 ? '' : 's'}</dd></div> : null}
    </dl>
    <ConsensusReceiptInspector canonicalJson={receipt.canonicalJson} bitcoinBlockHeight={anchored ? receipt.bitcoinBlockHeight : undefined} />
    <div className="mt-4 flex flex-wrap gap-2">
      <button type="button" className="btn-secondary" onClick={onDownloadJson}>Download receipt JSON</button>
      <button type="button" className="btn-secondary" disabled={!receipt.proofBase64} onClick={onDownloadProof}>Download .ots proof</button>
    </div>
    <div className="mt-5 rounded-xl bg-white p-4">
      <p className="font-semibold text-stone-900">Consensus reward</p>
      {reward?.status === 'paid' ? (
        <p className="mt-1 text-sm text-emerald-700">{rewardLabel} received.</p>
      ) : !submitted ? (
        <p className="mt-1 text-sm text-stone-500">
          Reward unlocks after timestamp submission.
        </p>
      ) : !reward ? (
        <p className="mt-1 text-sm text-stone-500">
          This receipt does not include a signet reward.
        </p>
      ) : (
        onClaimReward ? (
          <button type="button" onClick={onClaimReward} className="btn-primary mt-3 inline-flex">
            Claim {rewardLabel}
          </button>
        ) : claimAvailable ? (
          <a href={rewardUrl} className="btn-primary mt-3 inline-flex">
            Claim {rewardLabel}
          </a>
        ) : (
          <p className="mt-1 text-sm text-amber-800">
            Reward claim is temporarily unavailable; eligibility remains recorded.
          </p>
        )
      )}
      <p className="mt-3 text-xs text-stone-500">OpenTimestamps anchors to Bitcoin mainnet. The Wavelength reward uses signet test sats; these are separate rails.</p>
    </div>
  </section>;
}
