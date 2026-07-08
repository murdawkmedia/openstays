import { convexAuth } from '@convex-dev/auth/server';
import { Password } from '@convex-dev/auth/providers/Password';
import GitHub from '@auth/core/providers/github';
import Google from '@auth/core/providers/google';
import MicrosoftEntraID from '@auth/core/providers/microsoft-entra-id';
import { query } from './_generated/server';

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
/**
 * OAuth providers are ENV-GATED, same dormancy pattern as Stripe/Square/
 * Channex: set the provider's standard @auth/core env vars on the deployment
 * and its sign-in button appears; unset = absent. Secrets NEVER live in the
 * settings table (binding convention #7).
 *   GitHub:    AUTH_GITHUB_ID + AUTH_GITHUB_SECRET
 *   Google:    AUTH_GOOGLE_ID + AUTH_GOOGLE_SECRET
 *   Microsoft: AUTH_MICROSOFT_ENTRA_ID_ID + AUTH_MICROSOFT_ENTRA_ID_SECRET
 *              (+ optional AUTH_MICROSOFT_ENTRA_ID_ISSUER for a tenant)
 * Callback URL to register in each provider's console:
 *   https://<deployment>.convex.site/api/auth/callback/<github|google|microsoft-entra-id>
 * An OAuth sign-in still grants NOTHING until an owner adds a staffProfile —
 * requireStaff stays the single chokepoint regardless of how a user signed in.
 */
export const oauthConfigured = {
  github: Boolean(process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET),
  google: Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET),
  microsoft: Boolean(
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID && process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
  ),
};

const providers: Parameters<typeof convexAuth>[0]['providers'] = [Password];
if (oauthConfigured.github) providers.push(GitHub);
if (oauthConfigured.google) providers.push(Google);
// @convex-dev/auth materializes a bare provider function by calling it with NO
// argument (provider_utils materializeAndDefaultProviders: `provider()`).
// GitHub/Google tolerate an undefined config (they use `config?.`), but
// @auth/core's MicrosoftEntraID destructures `const { profilePhotoSize = 48 }
// = config` and throws on undefined. Pass an explicit `{}` so it materializes;
// clientId/clientSecret/issuer are still filled from AUTH_MICROSOFT_ENTRA_ID_*
// env vars by setEnvDefaults, exactly like the other providers.
if (oauthConfigured.microsoft) providers.push(MicrosoftEntraID({}));

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers,
});

/** Which sign-in methods this deployment offers — the login page renders one
 *  button per true entry. Public by design (a login page needs it pre-auth). */
export const availableAuthMethods = query({
  args: {},
  handler: async () => ({
    password: true,
    github: oauthConfigured.github,
    google: oauthConfigured.google,
    microsoft: oauthConfigured.microsoft,
  }),
});
