# Project site and application hosting

Primary: https://www.murdawkmedia.com/openstays/
Hosting guide: https://www.murdawkmedia.com/openstays/hosting/

The project site is static HTML/CSS in `static-site/`, with no application
backend, sign-in, booking or payment service. Examples are fictional. It needs
no package install or build step; publish that directory and configure the
host's sitemap/canonical URLs consistently.

```bash
python3 scripts/check-static-site.py
```

For a new hostname or path, update the HTML canonical/social/structured-data
URLs and use the checker's `--base-url` option. Assets and navigation are
relative. The static artifact is distinct from the full app's `dist/` output.

The full booking application remains in this repository. A future operator
provisions a fresh managed or self-hosted Convex backend, configures inventory,
auth and optional providers, and completes their own acceptance checks. See
[Restarting OpenStays](docs/restart.md). Old deployment names and keys are
historical records, not reusable service identities.

Nostr remains authoritative. The existing Murdawk Media GitHub repository is a
passive mirror: `nostr-main` mirrors maintained main, `nostr-showcase` retains
the historical hosted release, and other Nostr branches use the `nostr/`
prefix. Original GitHub branches remain intact and Actions are disabled.
The historical interactive subpath release is preserved on
`hosting/murdawk-subpath`; do not deploy it merely to match old documentation.

Historical recovery address: https://openstays-consensus.pages.dev/.
Browser-local wallets belong to their original browser origin. Recovery is
separate from the static project site and does not require publishing private
wallet or backend data. Do not clear browser storage, collect recovery words
or treat a new origin as an automatic wallet migration.

The project site does not inspect or modify browser wallets, backend records or
private archives. Host-level retirement/recovery routing is maintained separately
from this static artifact. No original recovery data belongs in public Git.
