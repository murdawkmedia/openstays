# Automation (API / CLI / MCP)

Everything a guest or staff member can do through the app, a script or agent
can do through the **same** HTTP API — the `/api/v1` routes call the same
Convex queries and mutations the UI does (`createHold`, `cancelByGuest`,
`availability.forUnitType`, `tapeForProperty`, and so on). No separate
business logic, no separate money math: the API gets every double-booking,
pricing, GST, and cancellation-policy guarantee the app gets, because it's
the same code path.

This page covers three layers built on top of that API:

- The **HTTP API v1** itself (auth, envelope, routes).
- The **`openstays` CLI** (`cli/`) — a thin command-line wrapper over it.
- The **MCP server** (`openstays mcp`) — the same operations exposed as tools
  for Claude and other MCP-aware clients.

## Honest scope

- Every route requires an API key — **including on the public demo
  deployment**. `DEMO_MODE` relaxes staff auth for the browser app; it grants
  nothing to `/api/v1` callers, so automations behave identically everywhere.
- A key's **scope** (`read` or `write`) is enforced server-side per route.
  Read keys can list properties, check availability, and read bookings;
  write keys can additionally create holds and cancel bookings. There is no
  scope that can bypass a guest's own confirmation-code + email match for
  cancellation, and no route that skips the conflict-checked, serializable
  hold transaction — the API cannot double-book any more than the UI can.
- v1 does not expose staff-only mutations beyond the booking tape (no
  inventory CRUD, no payment refund initiation beyond guest-cancellation
  refund policy). See the [roadmap](/roadmap) for what's landing later.

## Security model (what a key is, by design)

An API key is a **trusted automation credential** — treat it as
staff-equivalent, not as a narrowly scoped guest token. Two properties follow
from that and are intentional, not defects:

- **A `read` key can read the whole booking book.** The list, tape, and
  `bookings/<code>` routes return every booking's dates, occupancy, price
  breakdown, and confirmation code across the deployment (no guest name / email
  / phone is projected — that PII is deliberately withheld). A read key is a
  full-book read credential by design, the same visibility a staff login has;
  provision read keys accordingly, and revoke any key the moment it is no
  longer needed. If you need a caller that can only see part of the book, don't
  give it a key.
- **A `write` key can create many holds across different guest emails.** This
  is inherent to a booking API. The only throttle today is the per-guest-email
  active-hold cap (3), and holds self-expire after 35 minutes. A malicious or
  leaked write key could still create churn across many emails; a coarse
  per-key / global rate limit on the write routes is a future hardening item,
  not shipped in v1. Scope keys to `read` unless the automation genuinely needs
  to book, and rotate write keys promptly if exposure is suspected.

Server-side validation is always authoritative: every guarantee the guest UI
relies on — conflict-checked serializable holds, server-computed pricing, promo
caps, and **the unit's `maxOccupancy` limit** — is enforced in the mutation the
API calls, never trusted from the caller.

## Getting a URL and an API key

**`OPENSTAYS_URL`** is your Convex deployment's **HTTP Actions origin** — the
`https://<deployment-name>.convex.site` URL. This is *not* the same origin
your frontend's `VITE_CONVEX_URL` uses (`.convex.cloud`); `/api/v1` is
mounted on `.convex.site`. Find it on your
[Convex dashboard](https://dashboard.convex.dev) (Settings → URL & Deploy Key)
or infer it from your `.convex.cloud` URL by swapping the suffix.

**`OPENSTAYS_API_KEY`** is minted by a staff owner:

1. Sign in to the admin app as an owner.
2. Open **Settings → API keys**.
3. Create a key with a name and a scope (`read` or `write`).
4. Copy the raw token — format `osk_` followed by 48 hex characters — **it is
   shown exactly once**. OpenStays stores only its SHA-256 hash; if you lose
   the raw token, revoke it and mint a new one.

Treat the token like any other credential: it's a Bearer secret, not scoped
to an IP or referrer. Revoke a key the moment it's no longer needed.

```bash
export OPENSTAYS_URL=https://your-deployment.convex.site
export OPENSTAYS_API_KEY=osk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

## HTTP API v1 reference

All requests: `Authorization: Bearer <token>`. All responses: JSON, `200
{"data": ...}` on success or `{"error": {"code", "message"}}` with a
`400`/`401`/`403`/`404`/`409` status on failure. Money is integer cents;
dates are `'YYYY-MM-DD'` strings — see [Configuration](/configuration) for
what those mean.

| Method | Path | Scope | Notes |
|---|---|---|---|
| GET | `/api/v1/health` | none | `{ok, version}` — no auth required |
| GET | `/api/v1/properties` | read | active properties |
| GET | `/api/v1/unit-types?property=<slug>` | read | |
| GET | `/api/v1/units?property=<slug>` | read | |
| GET | `/api/v1/rate-plans?property=<slug>&unitType=<slug>` | read | |
| GET | `/api/v1/availability?property=<slug>&unitType=<slug>&from&to` | read | per-unit blocked nights |
| GET | `/api/v1/tape?property=<slug>&from&to` | read | admin booking tape |
| GET | `/api/v1/bookings?status&from&to&limit` | read | |
| GET | `/api/v1/bookings/<confirmationCode>` | read | |
| POST | `/api/v1/bookings/hold` | write | body = `createHold` args |
| POST | `/api/v1/bookings/<confirmationCode>/cancel` | write | body = `{email}` |
| POST | `/api/v1/promo-codes/preview` | read | body = `{code, property, unitType}` |

The canonical route list lives in `convex/apiV1.ts` (header comment) — treat
this table as a mirror of it, not a second source of truth.

## The `openstays` CLI

The CLI (`cli/`) is a thin wrapper over the table above — every command maps
1:1 to a route. It's a **separate package** inside this repo with its own
`package.json`; it doesn't affect the root app's install, build, or tests.

```bash
cd cli
npm install
npm run build
node dist/index.js health --url https://your-deployment.convex.site --key osk_...
```

Or export the env vars once and drop the flags:

```bash
export OPENSTAYS_URL=https://your-deployment.convex.site
export OPENSTAYS_API_KEY=osk_...
openstays health
```

(`openstays` on your `PATH` requires either `npm link` inside `cli/` or
installing the package from wherever you publish it — see `cli/README.md`.)

**Prefer the `OPENSTAYS_API_KEY` environment variable over `--key`.** A key
passed as `--key osk_...` lands in the OS process table (any local user can see
it via `ps` / Task Manager while the command runs) and in your shell history
file; the environment variable does not. The CLI prints a stderr warning
whenever `--key` is used. Keep `--key` for quick interactive use and set the
env var for anything scripted or long-lived.

### Commands

```bash
openstays health
openstays properties
openstays unit-types    --property pinewood-flats
openstays availability  --property pinewood-flats --unit-type lakeview-cabin \
                         --from 2026-07-01 --to 2026-07-10
openstays tape          --property pinewood-flats --from 2026-07-01 --to 2026-07-31
openstays bookings      --status confirmed --from 2026-07-01 --limit 20
openstays booking       OS-7K3M2Q
openstays hold          --unit-id <id> --rate-plan-id <id> \
                         --check-in 2026-07-01 --check-out 2026-07-03 \
                         --adults 2 --children 0 \
                         --name "Sam Guest" --email sam@example.com --phone 780-555-0100
openstays cancel        OS-7K3M2Q --email sam@example.com
openstays promo-preview --code SUMMER10 --property pinewood-flats --unit-type lakeview-cabin
openstays mcp
```

Every command accepts `--json` for raw API output instead of the default
compact table/summary. `openstays --help` lists commands; `openstays
--version` prints the CLI version. On an API error, the CLI prints `Error
[<code>] (HTTP <status>): <message>` to stderr and exits non-zero — safe to
script against (`if ! openstays cancel ...; then ...`).

`openstays hold` takes raw `unitId`/`ratePlanId` (Convex document IDs), not
slugs — look them up first via `unit-types` / `rate-plans`, the same way the
guest booking UI resolves them before calling `createHold`.

## MCP server

`openstays mcp` runs an MCP server over **stdio**, exposing the same
operations as tools. Point any MCP-aware client at the built CLI binary; it
reads `OPENSTAYS_URL` / `OPENSTAYS_API_KEY` from its own environment (set
them in the client's MCP server config, not just your shell).

### Tools

| Tool | Mirrors |
|---|---|
| `openstays_health` | `GET /health` |
| `openstays_list_properties` | `GET /properties` |
| `openstays_list_unit_types` | `GET /unit-types` |
| `openstays_list_units` | `GET /units` |
| `openstays_list_rate_plans` | `GET /rate-plans` |
| `openstays_availability` | `GET /availability` |
| `openstays_tape` | `GET /tape` |
| `openstays_list_bookings` | `GET /bookings` |
| `openstays_get_booking` | `GET /bookings/<code>` |
| `openstays_create_hold` | `POST /bookings/hold` |
| `openstays_cancel_booking` | `POST /bookings/<code>/cancel` |
| `openstays_promo_preview` | `POST /promo-codes/preview` |

Each tool returns the API's `{data}` payload as JSON text content on success,
or surfaces the `ApiError` (`[code] (HTTP status) message`) as a tool error
on failure — an agent sees the same structured error a script would.

### Registering with Claude Code / Claude Desktop

Add an entry to your MCP client's server config, pointing at the built CLI
and passing credentials via environment:

```json
{
  "mcpServers": {
    "openstays": {
      "command": "node",
      "args": ["/absolute/path/to/openstays/cli/dist/index.js", "mcp"],
      "env": {
        "OPENSTAYS_URL": "https://your-deployment.convex.site",
        "OPENSTAYS_API_KEY": "osk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}
```

Run `npm run build` in `cli/` first so `dist/index.js` exists. A write-scoped
key lets an agent create holds and cancel bookings on your behalf — mint a
read-only key instead if you only want it answering availability/booking
questions.
