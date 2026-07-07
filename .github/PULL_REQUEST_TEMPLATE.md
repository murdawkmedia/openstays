## What does this PR do?

<!-- Short description. Link the issue it closes, if any. -->

## Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] Added a line to `CHANGELOG.md`
- [ ] If this touches `shared/pricing.ts`, `convex/payments/**`, the
      hold/booking transaction in `convex/bookings.ts`, refunds, or the
      gift-certificate ledger: flagged below for adversarial review per
      `CONTRIBUTING.md` (money/availability diffs need a reviewer who tries
      to find a sequence of events where this loses money, double-charges,
      or double-books).

## Money / availability impact

<!--
If this PR touches pricing, holds, availability, refunds, or gift
certificates, describe the change here explicitly so reviewers know to
apply the adversarial-review standard from CONTRIBUTING.md. If it doesn't
touch any of those, write "None."
-->
