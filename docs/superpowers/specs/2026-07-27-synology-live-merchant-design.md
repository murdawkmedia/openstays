# Synology live merchant design

**Date:** 2026-07-27  
**Status:** approved direction; implementation pending  
**Scope:** Consensus Commons public showcase only

## Goal

Run the OpenStays signet merchant bridge on Murphy's Synology DS425 instead of
SHC or Cloudflare Containers. Preserve the existing fail-closed payment
authority, expose no wallet or daemon port publicly, and keep Zaprite and
Wavelength disabled until live acceptance and recovery checks pass.

SHC is explicitly out of scope for this deployment.

## Host layout

- Application root:
  `/volume1/docker/openstays-merchant`
- Persistent Wavelength state:
  `/volume1/docker/openstays-merchant/state/wavelength`
- Deployment configuration:
  `/volume1/docker/openstays-merchant/config`
- Encrypted backup generations:
  `/volume2/openstays-wallet-backups`
- Container architecture:
  `linux/amd64`

The OpenStays project must use its own Compose project, volumes, environment
file, health checks, and container names. It must not modify, restart, or
share secrets with existing Synology workloads.

## Runtime architecture

The existing checksum-pinned merchant image remains the runtime foundation:

- Wavelength `v0.1.0`, built with the required wallet RPC tags;
- official `opentimestamps-client==0.7.2`;
- compiled OpenStays CLI workers for Wavelength, OpenTimestamps, and mail;
- non-root runtime user;
- signet-only daemon arguments.

A Synology supervisor adapts the Cloudflare-container lifecycle to durable NAS
storage:

1. On first start, it remains unavailable until an authenticated operator
   bootstraps the wallet.
2. Bootstrap creates one merchant wallet and returns the recovery phrase once.
3. Before bootstrap succeeds, the supervisor writes and verifies the first
   encrypted backup generation on `/volume2`.
4. On every later start, the supervisor selects the newest valid generation,
   verifies its digest and authenticated encryption, restores it into an empty
   staging directory, then starts the daemon and workers.
5. While healthy, it creates encrypted backup generations at least once per
   minute after wallet activity can change.
6. A generation is current only after the encrypted archive and its manifest
   are durably written, reread, and verified.
7. A failed restore, stale backup, missing key, or unhealthy worker leaves the
   merchant status unavailable and keeps public Wavelength fail-closed.

The live wallet directory is not treated as the recovery source. Recovery
authority is the newest verified encrypted generation on `/volume2`.

## Network and trust boundaries

- The Wavelength REST gateway and RPC listeners bind only to container
  loopback.
- The merchant control endpoint binds only to the container network and is not
  published on Synology LAN, Tailscale, or the public internet.
- Operator actions run through authenticated `docker exec` commands from the
  approved G14-to-Synology administration path.
- CLI workers call the dedicated OpenStays Convex deployment over HTTPS using
  scoped bridge and heartbeat bearer tokens.
- The public browser calls only Cloudflare/Convex surfaces. It never reaches
  Synology directly.
- Cloudflare Turnstile eligibility remains mandatory for public Zaprite
  checkout, Wavelength payment, and reward claim actions.
- Zaprite settlement remains authoritative only after a server-side order
  fetch. Wavelength settlement remains authoritative only after the merchant
  worker matches exact signet network, request, invoice, amount, activity, and
  payment identifier.

## Secrets

Generate distinct values for:

- container control;
- wallet encryption;
- wallet password;
- Wavelength bridge and heartbeat;
- OpenTimestamps bridge and heartbeat;
- mail bridge and heartbeat;
- eligibility signing;
- operator administration.

Store Synology runtime values only in a root-readable deployment environment
file or Synology secret facility. Store matching server-side values only in
the dedicated Convex or Cloudflare deployment. Never commit, print, or copy
values into MurphyOS, logs, screenshots, or status notes.

The Zaprite API credential previously pasted into chat is treated as exposed
and must be replaced before the public Zaprite rail is enabled. Only the
dedicated Consensus Commons checkout may be used.

## Backup and recovery

Each backup generation contains:

- encrypted wallet archive using AES-256-GCM;
- versioned manifest;
- archive SHA-256;
- creation time;
- release identifier;
- monotonically increasing generation number.

Backup filenames contain no wallet, payment, guest, or booking identifiers.
Retain a bounded set of recent verified generations and never delete the last
known-good generation.

Before enabling Wavelength:

1. bootstrap once;
2. record the recovery phrase offline;
3. confirm the initial backup;
4. stop the merchant container;
5. move the live wallet directory aside without deleting it;
6. restore from the latest verified generation into a clean directory;
7. confirm the same signet wallet identity and activity;
8. confirm a fresh backup after restart.

The original live directory remains available until the restore drill passes.

## Public enablement sequence

All public flags begin disabled.

1. Deploy the Synology merchant runtime.
2. Complete wallet bootstrap and restore rehearsal.
3. Configure the dedicated Turnstile widget and eligibility edge.
4. Replace and configure the dedicated Zaprite credential and checkout.
5. Configure matching Convex bridge secrets.
6. Fund only the approved capped signet test budget.
7. Run live Zaprite and Wavelength booking acceptance.
8. Run the 1,000-sat signet reward acceptance.
9. Verify receipt submission, chat, email/log delivery, refund operations,
   desktop, and mobile.
10. Enable Zaprite and Wavelength independently only after their own gates
    pass. Enable rewards last with a capped daily budget.

Failure of one rail must not hide or stop the other rail or the simulated tour.

## Failure handling

- Missing or stale heartbeat hides Wavelength within 60 seconds.
- Insufficient signet balance never marks a reward paid.
- Ambiguous, expired, amountless, wrong-network, or excessive-fee invoices
  never dispatch funds.
- Required worker exit marks the merchant unhealthy and stops the remaining
  child processes.
- Backup failure keeps Wavelength unavailable; it does not delete the current
  wallet or prior verified generation.
- Zaprite remains independent of merchant daemon health.
- Rollback disables the affected public and Convex flags first, preserves all
  authoritative rows and backup generations, and never runs demo reset against
  real-payment rows.

## Verification

Automated coverage must prove:

- first-start bootstrap is single-use;
- existing state cannot silently bypass verified restore;
- corrupted, truncated, wrong-key, stale, or replayed backups fail closed;
- atomic manifest/archive publication;
- bounded generation retention preserves the last known-good backup;
- container restart restores before workers start;
- loopback-only daemon and control bindings;
- signet-only startup;
- worker crash propagation;
- duplicate payment and reward settlement remain no-ops.

Release gates remain:

- root tests, typecheck, build, docs build, and runtime audit;
- CLI tests, typecheck, build, and production audit;
- operations tests, typecheck, and build;
- checksum-pinned Linux image build and recovery drill;
- Synology Compose validation and health smoke;
- desktop and mobile browser acceptance;
- credential-dependent live acceptance before enabling each rail.

## Acceptance criteria

The design is complete when:

- the merchant runs on Synology with no public wallet/daemon/control port;
- encrypted, verified generations are stored on `/volume2`;
- a clean restore preserves wallet identity and activity;
- public Zaprite and Wavelength flows complete against authoritative state;
- a successful confirmed booking can unlock one 1,000-sat signet reward;
- OpenTimestamps submission remains distinct from eventual Bitcoin anchoring;
- all stop switches work independently;
- existing Synology containers and OpenStays simulated flow remain healthy.
