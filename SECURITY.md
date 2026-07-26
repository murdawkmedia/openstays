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
