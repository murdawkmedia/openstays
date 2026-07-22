# OpenStays Mail Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` only when the user explicitly asked for delegated workers; otherwise use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Resend-only delivery with an open, provider-neutral email queue that uses Mailpit locally and any SMTP service through an authenticated local bridge.

**Architecture:** Convex remains authoritative for rendering, idempotency, queue state, leases, and audit logs. A CLI worker polls authenticated HTTP endpoints, sends through SMTP, and reports success/failure; Mailpit is the default loopback SMTP destination, while Resend and log-only modes remain supported.

**Tech Stack:** TypeScript, Convex, Vitest, Node CLI, Nodemailer SMTP, Mailpit v1.30.5, PowerShell.

---

## File map

- Create `convex/emailDelivery.ts`: provider selection, queue claims, leases, and result mutations.
- Modify `convex/email.ts`: render once and dispatch through the selected provider.
- Modify `convex/schema.ts`: retain rendered payload and bridge state in `emailLog`.
- Modify `convex/http.ts`: authenticated mail bridge endpoints.
- Create `convex/emailDelivery.test.ts`: queue/idempotency/lease/auth tests.
- Create `cli/src/mailBridge.ts`: SMTP worker.
- Create `cli/src/mailBridge.test.ts`: worker and sanitization tests.
- Modify `cli/src/index.ts`: `openstays mail-bridge` command.
- Modify `cli/package.json`: Nodemailer and its types.
- Create `scripts/install-mailpit.ps1`: pinned verified installer.
- Create `scripts/start-mailpit.ps1`: loopback local inbox.
- Create `scripts/start-mail-bridge.ps1`: secret-preserving bridge startup.
- Modify `package.json`, `docs/hackathon-mvp.md`, `docs/configuration.md`, `CLAUDE.md`, and `STATUS.md`.

### Task 1: Add durable rendered-email queue state

**Files:**
- Modify: `convex/schema.ts`
- Create: `convex/emailDelivery.ts`
- Create: `convex/emailDelivery.test.ts`

- [ ] **Step 1: Write failing queue and lease tests**

Using `convexTest`, insert an `emailLog` queued for `mail_bridge` and assert that a bounded claim returns it once, a second immediate claim does not, an expired lease permits reclaim, and `markDelivered` is idempotent. Add an unauthorized bearer-token unit test using the existing timing-safe helper pattern.

```ts
expect(first).toHaveLength(1);
expect(second).toHaveLength(0);
expect(reclaimed[0]._id).toBe(first[0]._id);
expect(await markDeliveredTwice()).toEqual([{ delivered: true }, { delivered: false }]);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- convex/emailDelivery.test.ts`

Expected: FAIL because delivery queue functions and fields do not exist.

- [ ] **Step 3: Extend `emailLog` without changing its table name**

Add optional migration-safe fields:

```ts
provider: v.optional(v.union(v.literal('resend'), v.literal('mail_bridge'), v.literal('log_only'))),
from: v.optional(v.string()),
html: v.optional(v.string()),
text: v.optional(v.string()),
idempotencyKey: v.optional(v.string()),
attemptCount: v.optional(v.number()),
nextAttemptAt: v.optional(v.number()),
leaseToken: v.optional(v.string()),
leaseExpiresAt: v.optional(v.number()),
deliveredAt: v.optional(v.number()),
```

Add indexes `by_status_nextAttemptAt` on `[status, nextAttemptAt]` and `by_idempotencyKey` on `[idempotencyKey]`.

- [ ] **Step 4: Implement bounded claims and reports**

In `convex/emailDelivery.ts`, implement:

```ts
export const claimPending = internalMutation({
  args: { limit: v.number(), leaseToken: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const limit = Math.min(Math.max(Math.floor(args.limit), 1), 25);
    const rows = await ctx.db.query('emailLog')
      .withIndex('by_status_nextAttemptAt', (q) => q.eq('status', 'queued'))
      .take(limit * 2);
    const claimable = rows.filter((row) =>
      (row.nextAttemptAt ?? 0) <= now && (row.leaseExpiresAt ?? 0) <= now,
    ).slice(0, limit);
    for (const row of claimable) await ctx.db.patch(row._id, {
      leaseToken: args.leaseToken,
      leaseExpiresAt: now + 30_000,
    });
    return claimable.map((row) => ({
      ...row,
      leaseToken: args.leaseToken,
      leaseExpiresAt: now + 30_000,
    }));
  },
});
```

Add `markDelivered` and `markFailed` mutations that require the matching live lease token. `markFailed` increments attempts, clears the lease, sanitizes the error to 500 characters, and schedules `nextAttemptAt` at 60 seconds, 5 minutes, then 15 minutes; after three attempts it sets `failed`.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- convex/emailDelivery.test.ts`

Expected: all queue tests pass.

- [ ] **Step 6: Commit**

```powershell
git add -- convex/schema.ts convex/emailDelivery.ts convex/emailDelivery.test.ts
git commit -m "Add durable provider-neutral email queue"
```

### Task 2: Render once and dispatch by provider

**Files:**
- Modify: `convex/email.ts`
- Modify: `convex/email.test.ts`

- [ ] **Step 1: Add failing provider-selection tests**

Cover these exact configurations:

```ts
expect(selectEmailProvider({ EMAIL_PROVIDER: 'mail_bridge' })).toBe('mail_bridge');
expect(selectEmailProvider({ EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'key' })).toBe('resend');
expect(selectEmailProvider({ EMAIL_PROVIDER: 'resend' })).toBe('log_only');
expect(selectEmailProvider({ DEMO_MODE: 'true' })).toBe('log_only');
expect(() => selectEmailProvider({ EMAIL_PROVIDER: 'smtp' })).toThrow('INVALID_EMAIL_PROVIDER');
```

Assert `mail_bridge` writes the complete from/to/subject/html/text payload once with status `queued`, and duplicate action execution does not create another row.

- [ ] **Step 2: Run the email test and verify RED**

Run: `npm test -- convex/email.test.ts`

Expected: FAIL because provider selection and payload persistence are absent.

- [ ] **Step 3: Centralize delivery dispatch**

Add a pure `selectEmailProvider` and one `dispatchRenderedEmail` helper in `convex/email.ts`. Every confirmation, cancellation, conflict, staff, message, and refund action must call it instead of duplicating Resend fetch logic. The helper accepts a stable idempotency key supplied by the caller and returns the existing row for any matching key instead of inserting another logical notification, then:

- `log_only`: insert `logged` with rendered content;
- `mail_bridge`: insert `queued`, `attemptCount: 0`, `nextAttemptAt: Date.now()`;
- `resend`: retain the existing raw HTTPS request and update the same row.

Keep `getPriorLogStatus` for legacy callers, but use `idempotencyKey` as the
single deduplication authority for new dispatches. A queued, failed, sent, or
logged row is the same logical email and must never be recreated; retries mutate
that row in place.

- [ ] **Step 4: Run email and template tests**

Run:

```powershell
npm test -- convex/email.test.ts convex/refundEmailTemplates.test.ts convex/messages.test.ts
npm run typecheck
```

Expected: all pass.

- [ ] **Step 5: Commit**

```powershell
git add -- convex/email.ts convex/email.test.ts
git commit -m "Dispatch rendered email through configurable providers"
```

### Task 3: Add authenticated mail bridge HTTP endpoints

**Files:**
- Modify: `convex/http.ts`
- Modify: `convex/emailDelivery.ts`
- Modify: `convex/emailDelivery.test.ts`

- [ ] **Step 1: Add failing endpoint authorization tests**

Test `GET /mail-bridge/pending`, `POST /mail-bridge/delivered`, and `POST /mail-bridge/failed`. Each must return 401 for missing/wrong bearer tokens before reading a body. The authorized pending response must contain at most 25 records and only the fields needed for SMTP.

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- convex/emailDelivery.test.ts`

Expected: FAIL because routes are absent.

- [ ] **Step 3: Register exact routes**

Use `MAIL_BRIDGE_TOKEN` and `bridgeBearerAuthorized`. For pending, generate a cryptographically random lease token in the HTTP action and call `internal.emailDelivery.claimPending`. Delivered accepts `{ emailLogId, leaseToken, providerMessageId }`; failed accepts `{ emailLogId, leaseToken, error, retryable }`. Reject malformed JSON with 400 and mutation conflicts with 409.

- [ ] **Step 4: Run endpoint tests**

Run: `npm test -- convex/emailDelivery.test.ts`

Expected: all authorization, bounds, and replay tests pass.

- [ ] **Step 5: Commit**

```powershell
git add -- convex/http.ts convex/emailDelivery.ts convex/emailDelivery.test.ts
git commit -m "Expose authenticated mail delivery bridge"
```

### Task 4: Implement the SMTP CLI worker

**Files:**
- Create: `cli/src/mailBridge.ts`
- Create: `cli/src/mailBridge.test.ts`
- Modify: `cli/src/index.ts`
- Modify: `cli/package.json`
- Modify: `cli/package-lock.json`

- [ ] **Step 1: Install the SMTP library**

Run:

```powershell
npm --prefix cli install nodemailer@9.0.3
npm --prefix cli install --save-dev @types/nodemailer@8.0.1
```

Expected: dependencies and lockfile update without a direct Nodemailer audit
advisory. (The implementation moved from the originally proposed 7.0.10 pin
after verification found its high-severity advisory.)

- [ ] **Step 2: Write failing worker tests**

Inject a fake transporter and HTTP client. Assert one claimed email calls `sendMail` once with the stored payload, reports the returned `messageId`, reports sanitized failures, preserves lease tokens, and never logs SMTP credentials or message bodies.

```ts
expect(sendMail).toHaveBeenCalledWith({
  from: 'OpenStays <stays@example.test>',
  to: 'guest@example.test',
  subject: 'Booking confirmed',
  html: '<p>Confirmed</p>',
  text: 'Confirmed',
});
expect(deliveredBody.providerMessageId).toBe('mailpit-123');
```

- [ ] **Step 3: Run and verify RED**

Run: `npm --prefix cli test -- src/mailBridge.test.ts`

Expected: FAIL because the mail worker does not exist.

- [ ] **Step 4: Implement `runMailBridge`**

Read `OPENSTAYS_URL`, `MAIL_BRIDGE_TOKEN`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, optional `SMTP_USERNAME`/`SMTP_PASSWORD`, and `MAIL_BRIDGE_POLL_MS`. Default local SMTP to `127.0.0.1:1025` with TLS off. Use Nodemailer's SMTP transport, poll bounded work, send sequentially, and report each result. Redact URLs with credentials and replace CR/LF/control characters in errors before reporting.

- [ ] **Step 5: Register the command**

In `cli/src/index.ts`, add `mail-bridge` beside `wave-bridge`, with `--once` support for tests/operator checks. Help text must call it a local worker and state that secrets remain server-side.

- [ ] **Step 6: Run CLI tests and build**

Run:

```powershell
npm --prefix cli test -- src/mailBridge.test.ts src/index.test.ts
npm --prefix cli run typecheck
npm --prefix cli run build
```

Expected: all commands pass.

- [ ] **Step 7: Commit**

```powershell
git add -- cli/src/mailBridge.ts cli/src/mailBridge.test.ts cli/src/index.ts cli/package.json cli/package-lock.json
git commit -m "Add SMTP delivery worker to OpenStays CLI"
```

### Task 5: Install and run verified Mailpit locally

**Files:**
- Create: `scripts/install-mailpit.ps1`
- Create: `scripts/start-mailpit.ps1`
- Create: `scripts/start-mail-bridge.ps1`
- Modify: `package.json`

- [ ] **Step 1: Write installer contract assertions**

Create `scripts/install-mailpit.test.ps1` and assert the installer pins `v1.30.5`, uses the official release URL, expects SHA-256 `e9663820476f6ac6bb642ac4d7c4e5c514ff42013137447b5163548d49fd8c88`, and refuses a mismatched download.

- [ ] **Step 2: Run and verify RED**

Run: `powershell -ExecutionPolicy Bypass -File scripts/install-mailpit.test.ps1`

Expected: FAIL because the installer does not exist.

- [ ] **Step 3: Implement the verified installer**

Download `https://github.com/axllent/mailpit/releases/download/v1.30.5/mailpit-windows-amd64.zip` to a new temporary directory, verify with `Get-FileHash -Algorithm SHA256`, and extract under `%LOCALAPPDATA%\OpenStays\mailpit-v1.30.5`. Never overwrite an existing binary unless its hash matches.

- [ ] **Step 4: Implement loopback startup**

`start-mailpit.ps1` starts the verified binary hidden with SMTP `127.0.0.1:1025`, web UI `127.0.0.1:8025`, and data/logs under `%LOCALAPPDATA%\OpenStays\mailpit`. It prints only PID and `http://127.0.0.1:8025`.

`start-mail-bridge.ps1` reads the ignored Convex deployment from `.env.local`, captures `MAIL_BRIDGE_TOKEN` without printing it, sets local SMTP defaults, and starts `openstays mail-bridge` hidden.

- [ ] **Step 5: Add npm scripts and verify locally**

Add:

```json
"mailpit:install": "powershell -ExecutionPolicy Bypass -File scripts/install-mailpit.ps1",
"mailpit:start": "powershell -ExecutionPolicy Bypass -File scripts/start-mailpit.ps1",
"mail:bridge": "powershell -ExecutionPolicy Bypass -File scripts/start-mail-bridge.ps1"
```

Run the contract test, install, start, then verify HTTP 200 from `http://127.0.0.1:8025` and listening ports 1025/8025.

- [ ] **Step 6: Commit**

```powershell
git add -- package.json scripts/install-mailpit.ps1 scripts/install-mailpit.test.ps1 scripts/start-mailpit.ps1 scripts/start-mail-bridge.ps1
git commit -m "Add verified local Mailpit runtime"
```

### Task 6: End-to-end local email acceptance and documentation

**Files:**
- Modify: `docs/hackathon-mvp.md`
- Modify: `docs/configuration.md`
- Modify: `CLAUDE.md`
- Modify: `STATUS.md`

- [ ] **Step 1: Configure only the isolated Convex deployment**

Generate a random `MAIL_BRIDGE_TOKEN`, set `EMAIL_PROVIDER=mail_bridge`, and set `EMAIL_FROM=Consensus Commons <stays@openstays.local>` on `affable-wildcat-206`. Capture values without printing them. Do not configure production.

- [ ] **Step 2: Run a local message acceptance test**

Start Mailpit and the mail bridge. Create one fictional booking/message flow, then use Mailpit's local API to assert exactly one guest alert and one staff alert with the expected booking code, links, HTML, and text bodies. No message may leave localhost.

- [ ] **Step 3: Document operations**

Document provider selection, Mailpit URLs/ports, SMTP variables, token rotation, retry/lease behavior, Resend compatibility, Postal as an optional future SMTP destination, and the fact that Mailpit capture is not external delivery.

- [ ] **Step 4: Run all gates**

Run:

```powershell
npm test
npm run typecheck
npm run build
npm --prefix cli test
npm --prefix cli run typecheck
npm --prefix cli run build
git diff --check
```

Expected: every command exits 0; root/CLI test counts may increase from the current 318/53 baseline.

- [ ] **Step 5: Commit documentation and status**

```powershell
git add -- docs/hackathon-mvp.md docs/configuration.md CLAUDE.md STATUS.md
git commit -m "Document OpenStays Mail operations"
```

- [ ] **Step 6: Remind Murphy about Zaprite**

Before the first Zaprite acceptance run, stop and remind Murphy to create the dedicated sandbox organization, Test Payment connection, API key, and API checkout. Replace the temporary Signal21 credentials only after Murphy confirms those resources exist.
