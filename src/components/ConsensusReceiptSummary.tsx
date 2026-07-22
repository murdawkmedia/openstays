type Receipt = { publicId: string; status: string; sha256: string; calendarCount?: number; bitcoinBlockHeight?: number; proofBase64?: string };
type Reward = { status: string; satsAmount: number } | null;

export function ConsensusReceiptSummary({ receipt, reward, rewardUrl, onDownloadJson, onDownloadProof }: {
  receipt: Receipt; reward: Reward; rewardUrl: string; onDownloadJson: () => void; onDownloadProof: () => void;
}) {
  const submitted = receipt.status === 'submitted' || receipt.status === 'bitcoin_anchored';
  const anchored = receipt.status === 'bitcoin_anchored';
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
    <div className="mt-4 flex flex-wrap gap-2">
      <button type="button" className="btn-secondary" onClick={onDownloadJson}>Download receipt JSON</button>
      <button type="button" className="btn-secondary" disabled={!receipt.proofBase64} onClick={onDownloadProof}>Download .ots proof</button>
    </div>
    <div className="mt-5 rounded-xl bg-white p-4">
      <p className="font-semibold text-stone-900">Consensus reward</p>
      {reward?.status === 'paid' ? <p className="mt-1 text-sm text-emerald-700">210 signet sats received.</p> : submitted ?
        <a href={rewardUrl} className="btn-primary mt-3 inline-flex">Claim 210 signet sats</a> :
        <p className="mt-1 text-sm text-stone-500">Unlocks after timestamp submission.</p>}
      <p className="mt-3 text-xs text-stone-500">OpenTimestamps anchors to Bitcoin mainnet. The Wavelength reward uses signet test sats; these are separate rails.</p>
    </div>
  </section>;
}
