import { useState } from 'react';
import { useQuery } from 'convex/react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  KeyRound,
  MinusCircle,
} from 'lucide-react';

import { api } from '../../convex/_generated/api';
import { Spinner } from './Spinner';

/**
 * "Sign-in & activity" settings section. Two parts:
 *   1. Sign-in methods status — password always on; each OAuth provider shows
 *      configured / not-configured (from auth.availableAuthMethods). OAuth is
 *      env-only by design (AUTH_* env vars, binding convention #7) — there are
 *      NO secret inputs here.
 *   2. Activity — the recent audit trail (staff.recentActivity), collapsible
 *      like the channel sync log.
 *
 * Visible to any staff (both queries are staff-gated with the usual DEMO_MODE
 * carve-out), placed after the Channels section — matching its visibility.
 */

const ACTIVITY_LIMIT = 30;

// The callback URL each provider's console must be pointed at. <deployment> is
// the operator's Convex deployment name (docs cover finding it).
const CALLBACK_URL = 'https://<deployment>.convex.site/api/auth/callback/<provider-id>';

export function SignInActivitySection() {
  const methods = useQuery(api.auth.availableAuthMethods, {});

  return (
    <section className="card p-6">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-stone-900">
        <KeyRound className="h-5 w-5 text-emerald-700" aria-hidden="true" />
        Sign-in &amp; activity
      </h2>

      <div className="mt-4">
        <h3 className="text-sm font-semibold text-stone-800">Sign-in methods</h3>
        {methods === undefined ? (
          <Spinner label="Loading sign-in methods…" />
        ) : (
          <ul className="mt-2 space-y-1.5 text-sm">
            <MethodRow label="Email + password" configured configuredLabel="always on" />
            <MethodRow label="GitHub" configured={methods.github} env="AUTH_GITHUB_ID / AUTH_GITHUB_SECRET" />
            <MethodRow label="Google" configured={methods.google} env="AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET" />
            <MethodRow
              label="Microsoft"
              configured={methods.microsoft}
              env="AUTH_MICROSOFT_ENTRA_ID_ID / AUTH_MICROSOFT_ENTRA_ID_SECRET"
            />
          </ul>
        )}
        <p className="mt-3 rounded-lg bg-stone-50 px-4 py-3 text-xs text-stone-600">
          OAuth providers are enabled entirely through <code className="rounded bg-stone-100 px-1">AUTH_*</code>{' '}
          environment variables on the deployment (<code className="rounded bg-stone-100 px-1">npx convex env set …</code>)
          — there are deliberately no secret inputs here (binding convention #7: secrets never live in
          the settings table). Register this callback URL in each provider's console:
          <br />
          <code className="mt-1 inline-block break-all rounded bg-stone-100 px-1 py-0.5">{CALLBACK_URL}</code>
          <br />
          <a
            href="https://murdawkmedia.github.io/openstays/"
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 font-medium text-emerald-700 underline hover:text-emerald-800"
          >
            Setup docs <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </p>
      </div>

      <div className="mt-6">
        <h3 className="text-sm font-semibold text-stone-800">Activity</h3>
        <p className="mt-1 text-xs text-stone-500">
          Who changed what — property config, staff grants, API keys, channel setup.
        </p>
        <ActivityLog />
      </div>
    </section>
  );
}

function MethodRow({
  label,
  configured,
  env,
  configuredLabel,
}: {
  label: string;
  configured: boolean;
  env?: string;
  configuredLabel?: string;
}) {
  return (
    <li className="flex flex-wrap items-center gap-2">
      {configured ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
      ) : (
        <MinusCircle className="h-4 w-4 shrink-0 text-stone-400" aria-hidden="true" />
      )}
      <span className="font-medium text-stone-800">{label}</span>
      <span className={configured ? 'text-emerald-700' : 'text-stone-500'}>
        {configured ? configuredLabel ?? 'configured' : 'not configured'}
      </span>
      {!configured && env ? (
        <span className="text-xs text-stone-400">
          — set <code className="rounded bg-stone-100 px-1">{env}</code>
        </span>
      ) : null}
    </li>
  );
}

function ActivityLog() {
  const [open, setOpen] = useState(false);
  const activity = useQuery(api.staff.recentActivity, open ? { limit: ACTIVITY_LIMIT } : 'skip');

  return (
    <div className="mt-2">
      <button
        type="button"
        className="flex items-center gap-1.5 text-sm font-medium text-stone-600 hover:text-stone-900"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        )}
        Recent activity
      </button>

      {open ? (
        activity === undefined ? (
          <Spinner label="Loading activity…" />
        ) : activity.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">No activity recorded yet.</p>
        ) : (
          <>
            <ul className="mt-2 space-y-1.5 text-sm">
              {activity.map((entry, i) => (
                <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-stone-500" title={new Date(entry.ts).toLocaleString()}>
                    {relativeTime(entry.ts)}
                  </span>
                  <span className="font-medium text-stone-800">{entry.actorName}</span>
                  <span className="rounded bg-stone-100 px-1 font-mono text-xs text-stone-600">
                    {entry.action}
                  </span>
                  <span className="text-stone-600">{entry.detail}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-stone-400">Showing last {activity.length}.</p>
          </>
        )
      ) : null}
    </div>
  );
}

/** Compact relative time ("3m ago", "2h ago", "5d ago"), falling back to a date. */
function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(ts).toLocaleDateString();
}
