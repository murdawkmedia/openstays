# Quickstart

> The public project site is now static. These instructions describe a fresh
> application deployment, not access to a shared hosted backend. See
> [Restarting OpenStays](restart.md) for the current hosting paths.

OpenStays is a normal npm project on top of [Convex](https://convex.dev). There's
no separate database to install and no Docker Compose file — `npx convex dev`
provisions a free cloud dev deployment for you and wires up your local `.env.local`.

## 1. Clone and install

```bash
git clone https://github.com/murdawkmedia/openstays
cd openstays
npm install
```

## 2. Start Convex

```bash
npx convex dev
```

The first run walks you through logging in (or creating) a free Convex
account, creates a new project, and writes `VITE_CONVEX_URL` into
`.env.local` for you. Leave this command running in its own terminal —
it pushes your schema and functions and keeps them live-reloaded as you edit.

### No-account option

If you'd rather not create a Convex account just to poke around locally, run:

```bash
CONVEX_AGENT_MODE=anonymous npx convex dev
```

This spins up an anonymous local dev deployment. It's fine for exploring the
codebase. For online use, choose a managed or self-hosted backend as described
in [Restarting OpenStays](restart.md).

## 3. Configure disposable demo mode and seed inventory

Use only the new development backend selected above:

```bash
npx convex env set DEMO_MODE true
npx convex env set EMAIL_PROVIDER log_only
npm run seed
```

This loads the fictional **Pinewood Flats Campground** — three lakeview
cabins, a glamping yurt, and ten full-hookup RV sites, each with realistic
rate plans, seasons, deposit policies, and cancellation windows. It's the
only inventory that ships in this repo; everything else is data you load
into your own deployment (see [Configuration](/configuration)).

The seed is idempotent — running it again is a no-op if Pinewood Flats
already exists.

## 4. Run the app

For a wallet-free fictional showcase, set the public flags listed in
[Restarting OpenStays](restart.md), then run:

```bash
npm run dev
```

Open `http://localhost:5173`.

## 5. Book a stay at Pinewood Flats

Pick a unit type (try the Lakeview Cabin), choose dates, and go through the
guest checkout flow. The disposable backend's demo mode provides simulated
confirmation; keep real provider credentials out of this installation. Staff
routes are hidden by the public-showcase flags. Real operator access and
payment acceptance require the separate production-profile setup.

## Next steps

- [Configuration](/configuration) — how to describe your own property,
  units, rate plans, and add-ons as data.
- [Self-hosting & deployment](/self-hosting) — putting a real deployment
  online for guests to book against.
- [Availability & holds](/concepts/availability) — how the booking core
  keeps two guests from ever taking the same night.
