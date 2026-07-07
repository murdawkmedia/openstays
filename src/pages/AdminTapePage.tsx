import { useEffect, useState } from 'react';
import { useQuery } from 'convex/react';
import { ShieldAlert } from 'lucide-react';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { Spinner } from '../components/Spinner';
import { BookingTape } from '../components/BookingTape';
import { todayIso } from '../lib/dates';

const TAPE_WINDOW_DAYS = 21;

const LEGEND: Array<{ label: string; className: string }> = [
  { label: 'Hold', className: 'bg-amber-400/80' },
  { label: 'Confirmed', className: 'bg-emerald-500/80' },
  { label: 'External (iCal)', className: 'bg-sky-400/80' },
  { label: 'Blocked', className: 'bg-stone-400/80' },
];

/** M0 stub: no staff auth yet. Read-only booking tape, live via Convex reactivity. */
export function AdminTapePage() {
  const properties = useQuery(api.properties.listActive, {});
  const [propertyId, setPropertyId] = useState<Id<'properties'> | null>(null);

  useEffect(() => {
    if (!propertyId && properties && properties.length > 0) {
      setPropertyId(properties[0].propertyId);
    }
  }, [properties, propertyId]);

  const tape = useQuery(
    api.availability.tapeForProperty,
    propertyId ? { propertyId, startDate: todayIso(), days: TAPE_WINDOW_DAYS } : 'skip',
  );

  return (
    <div>
      <div className="mb-6 flex items-center gap-2 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <ShieldAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
        Staff auth arrives in M1. This page is unauthenticated for now.
      </div>

      <h1 className="mb-4 text-2xl font-semibold text-stone-900">Booking tape</h1>

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
