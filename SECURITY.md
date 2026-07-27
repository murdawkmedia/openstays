# Security Policy

OpenStays handles reservations and payments. If you find a vulnerability —
especially anything enabling double-booking, payment bypass, refund
manipulation, or guest-data exposure — please report it privately.

**Report to:** contact@murdawkmedia.com

Please include reproduction steps. We'll acknowledge within a few days and
credit you in the changelog unless you prefer otherwise.

Please do not open public issues for security reports, and do not test against
deployments you don't own (the public demo resets nightly and holds no real
data, but be considerate).

## Documentation development server

The VitePress development server is a loopback-only authoring tool and is not
part of the OpenStays production application or Cloudflare deployment. Do not
bind `npm run docs:dev` to a public interface. Production gates use
`npm audit --omit=dev --audit-level=high`; remaining development-only findings
must be re-evaluated whenever VitePress publishes a compatible fix.

## Runtime audit exception

OpenStays pins React Router 7.18.1. GitHub advisory
`GHSA-qwww-vcr4-c8h2` affects only applications using React Router's unstable
React Server Components APIs. OpenStays is a client-only Vite SPA and installs
neither React Router server tooling nor any RSC API. `npm run audit:runtime`
fails for every other high/critical runtime advisory and also fails if RSC
tooling or an RSC identifier is introduced. Remove this narrow exception once
a compatible patched `react-router-dom` release is available.

## Public payment showcase

Consensus Commons is fictional and provides no lodging service. Public live
payment mode requires an explicit disclosure and Turnstile-backed,
five-minute eligibility token before either rail can start.

- Zaprite webhook bodies and redirects are untrusted. The server-held API
  credential fetches the authoritative order and exact amount/currency.
- Wavelength is signet-only. Settlement requires matching completed merchant
  activity; invoices, prepared sends, pending activity, and browser claims are
  not authority.
- The merchant daemon is reproducibly built from Lightning Labs' checksum-
  pinned v0.1.0 source and vendor archives with its official `wavewalletrpc`
  and `swapruntime` tags. CI publishes the complete upstream binary scan and
  separately blocks every fixable application/base-image high or critical
  finding. Wavelength v0.1.0 has upstream findings that only a rebuilt release
  can resolve, so the daemon remains isolated to disposable signet test funds;
  never place real Bitcoin value in this wallet.
- OpenTimestamps submission and Bitcoin anchoring are separate states.
- Zaprite/Wavelength refunds remain paid until staff records the completed
  external refund reference.
- The reward budget defaults to zero and Wavelength disappears when its
  heartbeat, balance, or verified backup is unhealthy.
- Wallet archives use AES-256-GCM and immutable verified R2 generations.
  Missing/corrupt recovery prevents startup. Wallet bootstrap and forced
  restore are operator-authenticated, and recovery material is returned only
  during the single bootstrap response.
- Public maintenance minimizes nonessential guest/message/email data after 14
  days without deleting authoritative payment or receipt records.

Never expose a bridge token, provider credential, wallet password, recovery
phrase, invoice, payment identifier, guest record, or raw network address in a
public issue or diagnostic report. See the
[public-payment operator runbook](./docs/operations/public-live-payments-runbook.md).
