# Staff & auth

Staff sign-in has one authorization model no matter how someone gets in the
door. There are multiple sign-in *methods* — email+password always, plus
whichever of GitHub, Google, or Microsoft Entra ID a deployment has
configured (see [self-hosting](/self-hosting#optional-oauth-sign-in) for
setup and [Environment variables](/configuration#environment-variables) for
the exact vars) — but every one of them funnels into the same
[Convex Auth](https://labs.convex.dev/auth) `users` table, one row per
person, regardless of which provider they used to sign in.

Signing in, by any method, grants **nothing** on its own. Every staff-only
query and mutation goes through a single chokepoint, `requireStaff`
(`convex/staff.ts`), which requires an active `staffProfiles` row tied to
that user. There are two roles:

- **`owner`** — can grant and revoke staff, including other owners; a
  deployment always keeps at least one active owner (revoking the last one
  is refused).
- **`staff`** — everyday admin/front-desk access; can't manage other staff
  accounts.

A brand-new sign-up — whether that's a password account or someone clicking
"Sign in with GitHub" for the first time — sits in this state until an owner
explicitly adds them as staff. Nothing about *how* someone authenticated
changes what they can do; the OAuth providers are just additional doors into
the same gate.

## Audit log

Every staff/admin action that changes something — property settings, staff
grants and revocations, API key creation, channel-manager config, and so on
— is recorded as an append-only row in the `auditLog` table: who did it
(`actorName`, and the underlying `actorUserId` when it's a real signed-in
user rather than `demo`/`system`), what the action was, a human-readable
detail string, and a timestamp. Nothing in the audit log can be edited or
deleted after the fact.

Settings shows recent staff activity pulled straight from this log, so an
owner can see, at a glance, what changed on the deployment and who changed
it — without digging through the Convex dashboard.
