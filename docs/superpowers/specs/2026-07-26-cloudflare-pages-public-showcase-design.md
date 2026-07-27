# OpenStays Cloudflare Pages Public Showcase Design

Date: 2026-07-26  
Status: Approved direction; implementation pending

## Goal

Publish Consensus Commons as a safe, globally accessible OpenStays showcase
under the Murdawk Media Cloudflare account. The first release uses a stable
`pages.dev` URL, fictional data, simulated payments, and pre-seeded proof
states. It must explain the real signet and OpenTimestamps flows without
operating a public faucet or exposing local infrastructure.

## External boundaries

- Cloudflare account: Murdawk Media only.
- Pages project: `openstays-consensus`.
- Initial URL: `https://openstays-consensus.pages.dev`.
- Backend: a new, dedicated Murdawk Media Convex project/deployment.
- Never inspect, configure, or use unrelated projects.
- Never connect the public site to the existing local hackathon deployment.
- Do not add a custom domain, GitHub deployment secret, production payment
  credential, or SHC worker in this release.

Cloudflare and Convex creation are external actions. Credential-bearing files
or password-manager items may be opened only after the operator gives fresh
implementation-time approval. Secret values must never be printed, committed,
or copied into documentation.

## Public experience

The deployed application retains the real OpenStays customer-facing flow and
fictional Consensus Commons property. It adds an unmistakable public-showcase
boundary:

- fictional inventory and simulated booking payments;
- no production guest or operator data;
- Wavelength identified as an experimental signet rail using test sats;
- OpenTimestamps submission, pending confirmation, and Bitcoin anchoring shown
  as separate states;
- Channex described as adapter-ready, not connected;
- pre-seeded, sanitized examples demonstrate booking consensus, a receipt,
  proof maturation, and the 1,000-signet-sat reward.

When no merchant bridge is online, the interface must not offer a payment or
reward action that can remain indefinitely stuck. It should route visitors to
the pre-seeded completed example and explain that live signet settlement was
tested locally but is not operated as a public faucet.

## Backend policy

The dedicated Convex deployment runs with `DEMO_MODE=true` and contains only
fictional seed data. Demo email remains log-only. No Zaprite, Wavelength,
OpenTimestamps bridge, Channex, Resend, SMTP, or OAuth credentials are
configured.

The existing nightly demo reset remains the recovery boundary. The seed/reset
path must include Consensus Commons and the sanitized showcase examples so the
public story returns to a known state without an operator. No identifiers or
proof files from the local judge acceptance are copied into the public seed.

The public frontend receives only the new deployment's public Convex URL.
Server-held configuration remains in Convex environment variables.

## Deployment

The first release is a local, verified direct upload:

1. Install dependencies and the pinned, checksum-verified Wavelength runtime.
2. Run root and CLI tests, typechecks, builds, and the documentation build.
3. Build with `/` as the Vite base and the new public Convex URL.
4. Upload `dist/` to the new Pages project with Wrangler.
5. Verify the stable `pages.dev` URL before adding it to the hackathon gallery.

GitHub Actions auto-deploy is deferred. It can be added after the first public
release proves the Pages project, build inputs, and demo reset behavior.

## Security and failure behavior

- Public content and mutations affect fictional demo data only.
- Payment-provider and bridge configuration fails closed because no provider
  secrets exist.
- Staff auth and local wallet setup are not advertised as public features.
- Wallet seeds, passwords, bridge tokens, payment hashes, guest details, and
  local acceptance artifacts never enter the build or seed.
- COOP and COEP headers remain enabled, including Wavelength runtime assets.
- Direct client-route loads use a Cloudflare Pages SPA fallback.
- A failed external worker cannot be presented as settled or Bitcoin anchored.

If Convex is unavailable, the page should retain a clear branded shell and
report that the interactive demo is temporarily unavailable. Deployment must
not fall back to another Convex project.

## Acceptance criteria

- `https://openstays-consensus.pages.dev` returns HTTP 200 over HTTPS.
- Property, room, checkout, confirmation/showcase, and important deep links
  survive direct loads.
- The public site visibly states fictional data and signet test sats.
- Visitors can explore the booking flow and simulated confirmation without
  requiring a real wallet or provider account.
- A sanitized pre-seeded receipt demonstrates submitted/pending/anchored
  semantics without copying local acceptance identifiers.
- No live Wavelength or provider action is offered without its bridge.
- Desktop and 390px layouts have no horizontal overflow or console errors.
- COOP/COEP and runtime cache headers are present.
- Root/CLI tests, typechecks, builds, docs build, and focused browser smoke pass.
- The Cloudflare account is confirmed as the intended organization and unrelated projects remain
  untouched.

## Deferred work

- Custom Murdawk hostname and DNS.
- GitHub Actions deployment.
- Always-on SHC Wavelength, OpenTimestamps, or mail workers.
- Public signet wallet funding or rewards.
- Production Zaprite, Wavelength mainnet, customer inventory, or real email.
