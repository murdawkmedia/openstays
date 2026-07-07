import { convexAuth } from '@convex-dev/auth/server';
import { Password } from '@convex-dev/auth/providers/Password';

/**
 * Staff authentication (M1) — Convex Auth with email+password.
 *
 * Anyone can technically create a users row via signUp, but an account grants
 * NOTHING: every staff query/mutation goes through requireStaff (convex/staff.ts),
 * which demands an active staffProfiles row. Profiles are granted only by an
 * owner (staff.grantStaff) or by the orchestrator-run bootstrap
 * (`npx convex run staff:bootstrap '{"email":"...","name":"..."}'`).
 *
 * Deployment prerequisites (orchestrator-only, per deployment):
 *   npx convex env set JWT_PRIVATE_KEY -- "<pkcs8 pem>"
 *   npx convex env set JWKS '<jwks json>'
 *   npx convex env set SITE_URL https://<frontend-host>
 * (see docs/self-hosting for the key-generation snippet)
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password],
});
