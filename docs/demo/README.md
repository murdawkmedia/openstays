# Consensus Receipt sample

`consensus-receipt-sample.json` is fictional, contains no guest or stay data,
and uses the same privacy boundary as a real Consensus Receipt. Its matching
`.ots` file is a real OpenTimestamps proof submitted to the default public
calendars for the Bitcoin++ Toronto demo.

Fresh proofs are expected to remain pending for hours. Check and upgrade this
exact proof before the expo; never describe it as Bitcoin-anchored unless the
official client reports a Bitcoin block attestation.

```powershell
$env:OTS_WSL='true'
$env:OTS_WSL_PYTHONPATH='/root/.local/share/openstays/ots-bridge-python'
npm --prefix cli run start -- ots-bridge
```
