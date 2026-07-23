# OpenTimestamps Inspector and BOLT11 QR Design

**Date:** 2026-07-23  
**Status:** Approved design, awaiting written-spec review  
**Scope:** Local Bitcoin++ judge demo and reusable OpenStays presentation components

## Goal

Make Consensus Receipts independently understandable and verifiable from the
guest dashboard, and make every visible BOLT11 invoice scannable through the
standard QR payment pattern.

## OpenTimestamps boundary

OpenTimestamps.org provides an official in-browser verifier, but it does not
offer a permanent URL that can preload an OpenStays receipt and proof. OpenStays
must not imply otherwise.

The dashboard will therefore provide:

- a human-readable preview of the privacy-safe canonical receipt;
- an expandable, formatted view of the exact immutable canonical JSON;
- downloads for the canonical JSON and matching `.ots` proof;
- a link to the official `https://opentimestamps.org/` verifier with
  instructions to upload both downloaded files;
- a direct mainnet block-explorer link only when the receipt has an
  authoritative `bitcoin_anchored` state and block height.

The official verifier performs hashing in the browser. OpenStays will not
upload the guest's receipt or proof to another service automatically.

## Receipt inspector

Add a reusable `ConsensusReceiptInspector` presentation unit to the existing
guest receipt card.

It receives the authenticated guest's existing receipt object and parses the
already-stored canonical JSON for display. It does not add a public receipt
endpoint or create a second receipt representation.

The readable preview includes only fields already present in
`openstays.consensus-receipt.v1`:

- schema identifier;
- opaque booking commitment;
- public property name and slug;
- amount and currency;
- payment provider and authoritative status;
- booking status;
- status, payment, notification, and channel event digests;
- receipt creation time.

It excludes guest identity, email, confirmation code, stay dates, unit,
messages, notes, invoices, wallet data, and payment hashes.

The inspector displays:

- receipt ID and SHA-256 commitment;
- submitted, anchoring-pending, anchored, and failure states;
- calendar count when present;
- readable canonical fields;
- an accessible disclosure for formatted raw JSON;
- JSON and `.ots` download controls;
- the official OpenTimestamps verifier link;
- an anchored Bitcoin block link using the exact stored block height.

Pending or failed receipts never receive a Bitcoin block link. A malformed
canonical JSON value leaves the immutable download intact and displays an
honest preview-unavailable message rather than guessing fields.

## BOLT11 invoice component

Add one reusable `Bolt11Invoice` component for every visible amount-bearing
invoice:

- the 12,000-sat local demo-wallet funding invoice;
- the 1,000-sat guest booking invoice;
- the 1,000-sat consensus-reward invoice while merchant payment is pending;
- future BOLT11 surfaces that explicitly adopt the component.

The component renders:

- an SVG QR encoding the exact BOLT11 string with no URL wrapper;
- the exact sat amount;
- expiry when supplied;
- a prominent `Signet test sats` network label;
- abbreviated visible invoice text with an accessible expandable full value;
- a copy button with an announced copied/error state.

The full copyable BOLT11 remains available if QR rendering fails, so QR
generation can never block payment. The component does not decode the invoice,
infer authority, submit payment, or expose wallet secrets.

## Data flow

The receipt inspector uses the current authenticated `forGuest` receipt query.
No schema or bridge-protocol change is needed. The canonical JSON remains the
authoritative preview source, and its stored SHA-256 remains unchanged.

The wallet page already holds the booking and preflight BOLT11 values in
browser state. The reward page already receives the guest-created invoice from
`useWalletReceive`; it will retain that value while the reward is awaiting
merchant settlement so the shared invoice component can render it.

No invoice is sent anywhere new. QR generation occurs locally in the browser.

## Accessibility and responsive behaviour

- QR images have a useful accessible label containing network and amount, not
  the full invoice.
- Copy results use a polite live region.
- Raw JSON and full-invoice disclosures are keyboard-operable native
  `<details>` elements.
- Long hashes, JSON, and BOLT11 values wrap without horizontal overflow.
- Buttons preserve visible focus and do not rely on colour alone.
- The layout remains usable at 390 CSS pixels.

## Verification

Tests will prove:

- only approved canonical receipt fields appear in the readable preview;
- formatted raw JSON is escaped and byte-equivalent after parsing;
- malformed JSON fails closed without changing downloads;
- submitted/pending receipts have no block link;
- anchored receipts link to the exact mainnet block height;
- the external verifier target is exactly `https://opentimestamps.org/`;
- the QR encoder receives the exact BOLT11 value;
- Signet label, amount, expiry, copy fallback, and disclosures render;
- all three current invoice surfaces use the shared component;
- desktop and 390px layouts have no horizontal overflow or console errors.

The full root and CLI test, typecheck, build, and documentation gates must
remain green. Live localhost acceptance must preserve the funded browser
wallet's 12,000 spendable Signet sats and normal booking authentication gate.

## Exclusions

- No embedded OpenTimestamps proof parser or verifier.
- No stale JavaScript OpenTimestamps client.
- No automatic upload to OpenTimestamps.org.
- No public receipt lookup endpoint.
- No new receipt schema or bridge fields.
- No claim that calendar submission is already Bitcoin anchored.
- No mainnet payment rail, production deployment, push, or merge.
