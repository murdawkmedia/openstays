# Signet treasury

OpenStays can consolidate excess Signet funds from an operator-controlled
Wavelength merchant into a configured Signet boarding address. It never
touches a visitor wallet, reclaims a guest reward, or operates on mainnet.

This feature is inert by default. Enabling it, changing a live merchant
environment, or dispatching the first transfer requires explicit approval.
Begin in dry-run mode and inspect the private Staff Operations preview before
authorizing any transfer.

## Required reserve

The worker computes:

```text
required reserve =
  max(base reserve, unpaid reward principal plus reward fee allowances)
  + unresolved Wavelength refund liabilities
```

The default base reserve is 14,520 sats. The worker subtracts both that reserve
and the configured treasury fee allowance before proposing a principal. It
skips work when the excess principal is under 5,000 sats, a completed sweep is
inside the 24-hour cooldown, or another transfer is unresolved.

## Configuration

These values belong on the operator-controlled merchant host. The bridge bearer
token remains server-held and must never be exposed through a `VITE_` variable.

```dotenv
WAVELENGTH_TREASURY_ENABLED=false
WAVELENGTH_TREASURY_DRY_RUN=true
WAVELENGTH_TREASURY_ADDRESS=tb1p...
WAVELENGTH_TREASURY_RESERVE_SATS=14520
WAVELENGTH_TREASURY_MIN_SWEEP_SATS=5000
WAVELENGTH_TREASURY_COOLDOWN_MS=86400000
WAVELENGTH_TREASURY_MAX_FEE_SATS=1000
WAVELENGTH_TREASURY_JOURNAL_DIR=/operator-owned/durable/state/treasury-journal
```

The destination is configuration, not application logic, so it can be rotated
without a code release. Only a Signet taproot address is accepted.

## Safe rollout

1. Keep `WAVELENGTH_TREASURY_ENABLED=false` and confirm the rest of the merchant
   bridge remains healthy.
2. Set the intended destination and turn on only the feature flag while keeping
   `WAVELENGTH_TREASURY_DRY_RUN=true`.
3. Inspect the private Staff Operations view. Confirm the balance, reward
   liability, refund liability, protected reserve, proposed principal, and
   destination.
4. Obtain explicit approval for one bounded live Signet transfer.
5. Set dry-run false for that controlled acceptance window.
6. Let `openstays wave-bridge --once` claim a short lease, prepare the quote,
   write its durable journal, dispatch once, and reconcile the exact activity.
7. Return to dry-run until the transaction and reserve are independently
   checked.
8. Enable scheduled operation only after that acceptance passes.

The worker always passes an exact `amount_sat` and `sweep_all: false`; it will
never `sweepAll` the merchant wallet. Before dispatch it verifies the daemon is
on Signet, the destination is exact, the rail is on-chain, the quote is
complete and unexpired, the fee and total outflow are known, and the protected
reserve remains intact.

## Bridge endpoints

All endpoints require `Authorization: Bearer WAVELENGTH_BRIDGE_TOKEN`.

- `GET /wavelength-bridge/treasury/preview`
- `POST /wavelength-bridge/treasury/claim`
- `POST /wavelength-bridge/treasury/dispatched`
- `POST /wavelength-bridge/treasury/completed`
- `POST /wavelength-bridge/treasury/failed`

The bridge token authenticates the worker; it is not a browser credential.
Staff visibility uses normal Convex Auth and `requireStaff()`. Only an owner can
resolve an ambiguous transfer.

## Durable dispatch and recovery

The merchant writes and fsyncs a durable journal before calling the Wavelength
send endpoint. A restart first reads that journal and inspects wallet activity.
It never blindly repeats a send whose response may have been lost.

If the worker cannot prove whether a dispatched payment moved, the row becomes
`reconciliation_required`. That status blocks all subsequent automatic sweeps.
An owner must inspect the exact merchant activity and then record either:

- **failed**, with evidence that no transfer occurred; or
- **completed**, with the matching Signet transaction ID.

Do not delete the journal, edit the database row, or retry the send to clear an
ambiguity. Preserve both records until the owner reconciliation is audited.

## Local disposable wallet

A separate cleanup control can be enabled for an unlocked disposable browser
wallet by setting `VITE_WAVELENGTH_LOCAL_TREASURY_ADDRESS` in a local build and
opening the existing `?demoSetup=1` flow on a loopback host. It is excluded from
public showcase builds, requires quote review plus an explicit checkbox, and
protects a local reserve and fee allowance. This control is never available to
ordinary visitor wallets.

## Network boundary

The treasury rejects mainnet. A `tb1p…` address is a Signet on-chain boarding
address, not a mainnet Lightning destination. Real mainnet Lightning would
require a network-matching mainnet BOLT11 invoice and a mainnet-enabled wallet,
both of which are outside this project.

Wavelength documents that a boarding address receives on-chain funds that are
swept into the wallet’s VTXO balance, and that bounded cooperative on-chain
sends accept an address plus exact amount. See the
[deposit guide](https://wavelength.lightning.engineering/guides/get-a-deposit-address/)
and [send guide](https://wavelength.lightning.engineering/guides/send-a-payment/).
