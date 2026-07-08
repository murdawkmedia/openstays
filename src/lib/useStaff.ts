// Shared staff-auth gating helper for /admin pages (M1).
//
// `me` is `undefined` while the query is loading, `null` when signed out or
// signed in but not (yet) granted staff access, and the staff profile
// otherwise. Pages combine this with `useConvexAuth()` to distinguish
// "not signed in" (redirect to /admin/login) from "signed in, no grant yet"
// (show a waiting message + sign-out, never redirect-loop back to login).

import { useConvexAuth } from '@convex-dev/auth/react';
import { useQuery } from 'convex/react';

import { api } from '../../convex/_generated/api';

export type StaffGateState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'awaiting_access' }
  | { status: 'staff'; name: string; role: 'owner' | 'staff' };

export function useStaffGate(): StaffGateState {
  const { isLoading: authLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.staff.me, isAuthenticated ? {} : 'skip');

  if (authLoading) return { status: 'loading' };
  if (!isAuthenticated) return { status: 'signed_out' };
  if (me === undefined) return { status: 'loading' };
  if (me === null) return { status: 'awaiting_access' };
  return { status: 'staff', name: me.name, role: me.role as 'owner' | 'staff' };
}
