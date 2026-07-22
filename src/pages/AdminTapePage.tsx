import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useQuery } from 'convex/react';
import { useAuthActions } from '@convex-dev/auth/react';
import { ShieldAlert, ShieldCheck } from 'lucide-react';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { Spinner } from '../components/Spinner';
import { BookingTape } from '../components/BookingTape';
import { todayIso } from '../lib/dates';
import { useStaffGate } from '../lib/useStaff';

const TAPE_WINDOW_DAYS = 21;

const LEGEND: Array<{ label: string; className: string }> = [
  { label: 'Hold', className: 'bg-amber-400/80' },
  { label: 'Confirmed', className: 'bg-emerald-500/80' },
  { label: 'External (iCal)', className: 'bg-sky-400/80' },
  { label: 'Blocked', className: 'bg-stone-400/80' },
];

/** Staff-only (M1): booking tape, live via Convex reactivity. */
export function AdminTapePage() {
  const gate = useStaffGate();
  const { signOut } = useAuthActions();

  const properties = useQuery(api.properties.listActive, gate.status === 'staff' ? {} : 'skip');
  const [propertyId, setPropertyId] = useState<Id<'properties'> | null>(null);

  useEffect(() => {
    if (!propertyId && properties && properties.length > 0) {
      setPropertyId(properties[0].propertyId);
    }
  }, [properties, propertyId]);

  const tape = useQuery(
    api.availability.tapeForProperty,
    gate.status === 'staff' && propertyId ? { propertyId, startDate: todayIso(), days: TAPE_WINDOW_DAYS } : 'skip',
  );

  if (gate.status === 'loading') return <Spinner label="Checking staff access…" />;
  if (gate.status === 'signed_out') return <Navigate to="/admin/login" replace />;
  if (gate.status === 'awaiting_access') {
    return (
      <div className="mx-auto max-w-md space-y-4 text-center">
        <ShieldAlert className="mx-auto h-8 w-8 text-amber-600" aria-hidden="true" />
        <h1 className="font-display text-xl font-semibold text-stone-900">Awaiting staff access</h1>
        <p className="text-sm text-stone-600">
          You're signed in but no owner has granted you staff access yet. Ask an owner to add you from{' '}
          <span className="font-medium">Settings → Staff</span>.
        </p>
        <button type="button" className="btn-secondary" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <span className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          Signed in as {gate.name} ({gate.role})
        </span>
        <button type="button" className="text-xs font-medium text-emerald-700 underline hover:text-emerald-900" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>

      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-stone-900">Booking tape</h1>
        <Link to="/admin/operations" className="text-sm font-medium text-emerald-700 hover:text-emerald-900">
          Messages & refunds
        </Link>
        <Link to="/admin/settings" className="text-sm text-stone-500 hover:text-stone-800">
          Settings →
        </Link>
      </div>

      {properties === undefined ? (
        <Spinner label="Loading properties…" />
      ) : properties.length === 0 ? (
        <p className="text-stone-500">No properties yet.</p>
      ) : (
        <div className="mb-6 max-w-xs">
          <label className="field-label" htmlFor="property-select">
            Property
          </label>
          <select
            id="property-select"
            className="field-input"
            value={propertyId ?? ''}
            onChange={(e) => setPropertyId(e.target.value as Id<'properties'>)}
          >
            {properties.map((p) => (
              <option key={p.propertyId} value={p.propertyId}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {tape === undefined ? (
        <Spinner label="Loading tape…" />
      ) : (
        <div className="card p-4">
          <div className="mb-4 flex flex-wrap gap-4 text-xs text-stone-600">
            {LEGEND.map((item) => (
              <span key={item.label} className="flex items-center gap-1.5">
                <span className={`h-3 w-3 rounded ${item.className}`} />
                {item.label}
              </span>
            ))}
          </div>
          <BookingTape startDate={tape.startDate} days={TAPE_WINDOW_DAYS} units={tape.units} bookings={tape.bookings} />
        </div>
      )}
    </div>
  );
}
