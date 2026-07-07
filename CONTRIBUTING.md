# Contributing to OpenStays

Thanks for looking! This project is young and the fastest way to help is to
open an issue describing your property's booking rules that we don't model yet.

## Dev setup

```bash
npm install
npx convex dev        # your own free dev deployment
npm run seed
npm run dev
```

## Before you open a PR

- `npm run typecheck` and `npm test` must pass.
- Read `CLAUDE.md` — the binding conventions (integer cents, ISO dates,
  half-open nights, the `unitNights` invariant) are not stylistic preferences;
  tests enforce them.
- Add a line to `CHANGELOG.md`.

## Money & availability changes get adversarial review

Any PR touching `shared/pricing.ts`, `convex/payments/**`, the hold/booking
transaction, refunds, or gift certificates will be reviewed with one question:
*"Find a sequence of events where this loses money, double-charges, or
double-books."* Expect that standard — it's the whole point of the project.
