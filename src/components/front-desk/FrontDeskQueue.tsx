import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import type { FrontDeskMode } from '../../../shared/dailyOperations';
import type { QueueRow } from './types';

function label(value: string) { return value.replaceAll('_', ' '); }

export function FrontDeskQueue(props: { rows: QueueRow[]; mode: FrontDeskMode; onSelect(row: QueueRow): void }) {
  if (props.rows.length === 0) return <div className="card p-8 text-center text-stone-500">No records match this queue and its current filters.</div>;
  return (
    <div className="space-y-3" aria-label="Front desk records">
      {props.rows.map((row) => (
        <button key={row.bookingId} type="button" className="card grid w-full gap-3 p-4 text-left transition hover:border-emerald-400 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(7rem,1fr))_auto] md:items-center" onClick={() => props.onSelect(row)}>
          <span className="min-w-0"><span className="block truncate font-semibold text-stone-950">{row.guestName}</span><span className="block truncate text-sm text-stone-500">{row.confirmationCode} · {row.unitName} · party of {row.partySize}</span>{row.openFlags.length ? <span className="mt-2 flex flex-wrap gap-1">{row.openFlags.map((flag) => <span key={flag.flagId} className={`rounded-full px-2 py-0.5 text-xs font-semibold ${flag.severity === 'urgent' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>{label(flag.kind)}</span>)}</span> : null}</span>
          <span><span className="block text-xs text-stone-500">Stay</span><span className="text-sm">{row.checkIn} → {row.checkOut}</span></span>
          <span><span className="block text-xs text-stone-500">Readiness</span><span className={`inline-flex items-center gap-1 text-sm font-semibold ${row.readiness === 'ready' ? 'text-emerald-700' : 'text-amber-700'}`}>{row.readiness === 'ready' ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}{label(row.readiness)}</span></span>
          <span><span className="block text-xs text-stone-500">Balance</span><span className="text-sm font-semibold">${(row.balanceCents / 100).toFixed(2)}</span></span>
          <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-semibold text-stone-700">{label(row.status)}</span>
          {props.mode === 'detailed' ? <span className="md:col-span-5 grid gap-2 border-t border-stone-100 pt-3 text-xs text-stone-600 sm:grid-cols-3"><span>Check-in policy: {row.policySummary.standardCheckInTime}</span><span>Check-out policy: {row.policySummary.standardCheckOutTime}</span><span>{row.housekeepingProgress ? `Housekeeping: ${row.housekeepingProgress.completed}/${row.housekeepingProgress.total}` : 'No housekeeping handoff'}</span></span> : null}
        </button>
      ))}
    </div>
  );
}
