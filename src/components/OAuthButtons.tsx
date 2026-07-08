import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthActions } from '@convex-dev/auth/react';
import { Github } from 'lucide-react';

import { ErrorMessage, extractErrorMessage } from './ErrorMessage';

/**
 * OAuth sign-in buttons for the staff login page. One button per env-gated
 * provider that convex/auth.ts registered (availableAuthMethods). Clicking a
 * button starts the standard OAuth redirect flow via signIn(providerId).
 *
 * The provider ids are the EXACT ids @auth/core registers and convexAuth wires
 * up: 'github', 'google', 'microsoft-entra-id'. (Verified against
 * node_modules/@auth/core/providers/*.js — the Microsoft provider's id is
 * 'microsoft-entra-id', NOT 'microsoft'; its env vars are
 * AUTH_MICROSOFT_ENTRA_ID_ID / _SECRET.)
 *
 * An OAuth sign-in grants NOTHING until an owner adds a staffProfile —
 * requireStaff stays the single chokepoint (convex/staff.ts).
 */

type AuthMethods = {
  password: boolean;
  github: boolean;
  google: boolean;
  microsoft: boolean;
};

// The @auth/core provider id that signIn() must be called with.
type ProviderId = 'github' | 'google' | 'microsoft-entra-id';

export function OAuthButtons({ methods }: { methods: AuthMethods }) {
  const { signIn } = useAuthActions();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<ProviderId | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleOAuth(provider: ProviderId) {
    setError(null);
    setBusy(provider);
    try {
      // OAuth is a full-page redirect flow; on providers that resolve inline
      // (or in tests) we also navigate to /admin. requireStaff still gates.
      await signIn(provider);
      navigate('/admin');
    } catch (err) {
      setError(extractErrorMessage(err));
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      {methods.github ? (
        <button
          type="button"
          className="btn-secondary w-full justify-center"
          disabled={busy !== null}
          onClick={() => void handleOAuth('github')}
        >
          <Github className="h-4 w-4" aria-hidden="true" />
          {busy === 'github' ? 'Redirecting…' : 'Continue with GitHub'}
        </button>
      ) : null}

      {methods.google ? (
        <button
          type="button"
          className="btn-secondary w-full justify-center"
          disabled={busy !== null}
          onClick={() => void handleOAuth('google')}
        >
          <GoogleMark />
          {busy === 'google' ? 'Redirecting…' : 'Continue with Google'}
        </button>
      ) : null}

      {methods.microsoft ? (
        <button
          type="button"
          className="btn-secondary w-full justify-center"
          disabled={busy !== null}
          onClick={() => void handleOAuth('microsoft-entra-id')}
        >
          <MicrosoftMark />
          {busy === 'microsoft-entra-id' ? 'Redirecting…' : 'Continue with Microsoft'}
        </button>
      ) : null}

      {error ? (
        <div className="pt-1">
          <ErrorMessage message={error} />
        </div>
      ) : null}
    </div>
  );
}

// Inline brand marks — self-contained SVG (no external asset requests, matching
// the codebase's inline-only asset convention).
function GoogleMark() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1a11 11 0 0 0-9.82 6.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

function MicrosoftMark() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#F25022" d="M2 2h9.5v9.5H2V2Z" />
      <path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5V2Z" />
      <path fill="#00A4EF" d="M2 12.5h9.5V22H2v-9.5Z" />
      <path fill="#FFB900" d="M12.5 12.5H22V22h-9.5v-9.5Z" />
    </svg>
  );
}
