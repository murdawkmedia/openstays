# Self-hosting & deployment

OpenStays has two independently-deployable pieces: the **Convex backend**
(schema, mutations, queries, crons, HTTP endpoints) and the **static
frontend** (React + Vite build output). This split is what makes "your own
deployment, your own data" possible — you're never renting space in someone
else's multi-tenant database.

There are two paths for the backend, and several options for the frontend.

## Backend path 1: Convex Cloud (default, recommended)

This is what `npx convex dev` gives you, and what the [Quickstart](/quickstart)
walks through. Convex hosts your deployment; you get serializable
transactions, realtime queries, scheduled functions (crons), file storage,
and HTTP endpoints without running any infrastructure yourself. The free
tier is generous enough that a single-property deployment costs ~$0/month.

Your data lives in Convex's cloud, scoped entirely to your own project — it
is not shared with, or visible to, other OpenStays deployments. You can
export it at any time from the dashboard.

## Backend path 2: self-hosted convex-backend

If you want the backend running on infrastructure you control end to end,
Convex publishes an open-source backend you can self-host:
[github.com/get-convex/convex-backend](https://github.com/get-convex/convex-backend).
This gets you the same transactional/query semantics OpenStays depends on,
with no dependency on Convex's hosted service. This path is more involved to
operate (you're responsible for the database, backups, and uptime) and isn't
covered turn-key by this repo's scripts — treat it as the option for
operators who need full self-hosting as a hard requirement.

## Frontend hosting

The frontend is a static Vite build (`npm run build` → `dist/`), so it can be
hosted anywhere that serves static files: GitHub Pages, Cloudflare Pages,
Netlify, S3 + CloudFront, etc.

### Production build pattern

Pair your static host's build step with a Convex deploy so your functions
ship in lockstep with your frontend:

```bash
npx convex deploy --cmd 'npm run build'
```

This deploys your Convex functions to your production deployment *and* runs
your frontend build with the right production `VITE_CONVEX_URL`
automatically injected. It needs a deploy key, which you generate from the
Convex dashboard (Settings → Deploy Keys) and set as the `CONVEX_DEPLOY_KEY`
environment variable in your host's build settings (GitHub Actions secret,
Cloudflare Pages environment variable, etc.) — never commit it.

Example for a Cloudflare Pages project:

- **Build command:** `npx convex deploy --cmd 'npm run build'`
- **Build output directory:** `dist`
- **Environment variable:** `CONVEX_DEPLOY_KEY` (set as a secret, production
  scope)

The same pattern applies to any static host that lets you set a custom
build command and a secret environment variable.

### GitHub Pages demo build

This repo's own `.github/workflows/pages.yml` publishes two things to GitHub
Pages on every push to `main`: the docs site (this site, at the root) and a
public read/write **demo** deployment of the app itself, under `/demo/`. See
that workflow for the exact `VITE_BASE` / `VITE_CONVEX_URL` wiring if you
want to replicate a similar split-publish setup for your own fork.

## Demo mode

Setting the Convex environment variable `DEMO_MODE=true` on a deployment
(`npx convex env set DEMO_MODE true`) turns on two things, and **only**
these two things:

- **Simulated payments** — the guest checkout flow can confirm a booking
  through `bookings.confirmSimulated` instead of a real payment provider.
  This mutation explicitly checks `DEMO_MODE` and refuses to run otherwise,
  so it can't accidentally activate on a real operator's deployment.
- **Nightly reset** — a cron (`convex/crons.ts` → `convex/demo.ts`) wipes all
  domain tables and re-seeds the fictional Pinewood Flats Campground every
  night. This mutation also checks `DEMO_MODE` and no-ops if it's unset.

Never set `DEMO_MODE=true` on a deployment holding real guest data — it
exists solely for the public demo instance and for kicking the tires
locally without a payment provider configured.
