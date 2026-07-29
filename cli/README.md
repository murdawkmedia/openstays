# @openstays/cli

Command-line and MCP client for the OpenStays HTTP API v1. Thin, well-tested
wrapper — no business logic lives here; every guarantee (double-booking
safety, pricing, GST, cancellation policy) is enforced server-side by the
same code path the guest-facing app uses.

This is a **separate, self-contained package** inside the OpenStays repo
(`cli/`). It has its own `package.json`, its own `npm install`, and its own
test/build scripts — it is not a workspace member of the root project, so it
never touches the root `npm test` / `npm run build`.

See [`docs/automation.md`](../docs/automation.md) in the main repo for the
full guide (getting a URL + API key, every command, MCP client setup). This
file is the quick reference for people working directly in `cli/`.

## Install

```bash
cd cli
npm install
npm run build      # emits dist/index.js
```

Or run from source without building, via `tsx`:

```bash
npm start -- health --url https://your-deployment.convex.site --key osk_...
```

## Configure

```bash
export OPENSTAYS_URL=https://your-deployment.convex.site
export OPENSTAYS_API_KEY=osk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

`OPENSTAYS_URL` is your Convex deployment's **HTTP Actions origin** — the
`https://<deployment-name>.convex.site` URL (not `.convex.cloud`, which is the
client SDK origin). `OPENSTAYS_API_KEY` is minted by a staff owner from the
admin settings UI (`osk_` + 48 hex characters, shown once at creation). Both
can be overridden per-invocation with `--url` / `--key`.

**Prefer `OPENSTAYS_API_KEY` in the environment over `--key`.** Passing the key
with `--key` puts the raw secret in your OS process table (visible to `ps` /
Task Manager while the command runs) and in your shell history. The CLI prints
a stderr warning when you use `--key` for exactly this reason. Reserve `--key`
for throwaway/interactive use; automations should set the env var.

## Commands

```
openstays health
openstays properties
openstays unit-types      --property <slug>
openstays availability    --property <slug> --unit-type <slug> --from <YYYY-MM-DD> --to <YYYY-MM-DD>
openstays tape            --property <slug> --from <YYYY-MM-DD> --to <YYYY-MM-DD>
openstays bookings        [--status <status>] [--from <d>] [--to <d>] [--limit <n>]
openstays booking         <confirmationCode>
openstays hold            --unit-id <id> --rate-plan-id <id> --check-in <d> --check-out <d>
                           --adults <n> [--children <n>] --name <n> --email <e> [--phone <p>]
                           [--marketing-opt-in] [--promo-code <c>]
openstays cancel          <confirmationCode> --email <e>
openstays promo-preview   --code <c> --property <slug> --unit-type <slug>
openstays mcp
openstays wave-bridge     [--once]
openstays ots-bridge      [--once]
openstays mail-bridge     [--once]
```

Add `--json` to any command for raw JSON output instead of the default
compact human summary. `openstays --help` / `-h` prints the full command
list; `openstays --version` prints the CLI version.

Errors from the API (`ApiError`) print `Error [<code>] (HTTP <status>):
<message>` to stderr and exit non-zero.

## Wavelength bridge and treasury

`openstays wave-bridge` reconciles merchant invoices and signet rewards. It
also evaluates the optional treasury once per poll when
`WAVELENGTH_TREASURY_ENABLED=true`. Treasury defaults remain disabled and
dry-running:

```dotenv
WAVELENGTH_TREASURY_ENABLED=false
WAVELENGTH_TREASURY_DRY_RUN=true
WAVELENGTH_TREASURY_ADDRESS=tb1p...
WAVELENGTH_TREASURY_RESERVE_SATS=14520
WAVELENGTH_TREASURY_MIN_SWEEP_SATS=5000
WAVELENGTH_TREASURY_COOLDOWN_MS=86400000
WAVELENGTH_TREASURY_MAX_FEE_SATS=1000
WAVELENGTH_TREASURY_JOURNAL_DIR=/durable/operator/state/treasury-journal
```

The worker rejects non-signet daemons, claims a short server lease, prepares a
bounded cooperative on-chain amount, validates the exact quote, and writes a
durable journal before dispatch. It will never `sweepAll`. If a send may have
left the daemon but its response is ambiguous, the worker reports
`reconciliation_required` and does not retry it. A staff owner must reconcile
the exact activity before another automated transfer can run.

Turning dry-run off or approving the first live Signet transfer requires
explicit approval. See the
[Signet treasury runbook](../docs/operations/signet-treasury.md).

## MCP server

`openstays mcp` runs an MCP server over stdio exposing the same operations as
tools (`openstays_health`, `openstays_list_properties`,
`openstays_list_unit_types`, `openstays_list_units`,
`openstays_list_rate_plans`, `openstays_availability`, `openstays_tape`,
`openstays_list_bookings`, `openstays_get_booking`, `openstays_create_hold`,
`openstays_cancel_booking`, `openstays_promo_preview`). See
`docs/automation.md` for client registration examples.

## Development

```bash
npm test          # vitest — unit tests against a mocked fetch + fake client, no live server needed
npm run typecheck  # tsc --noEmit
npm run build      # tsc, emits dist/
```
