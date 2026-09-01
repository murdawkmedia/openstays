import { useState } from 'react';
import { Link } from 'react-router-dom';
import { X } from 'lucide-react';

import { BOOKING_OPERATIONAL_FLAG_KINDS, OPERATIONAL_FLAG_SEVERITIES, RESTRICTED_FLAG_KINDS, type BookingOperationalFlagKind, type OperationalFlagSeverity } from '../../../shared/dailyOperations';
import type { CreateFlagInput, FrontDeskAssignee, QueueRow } from './types';

export function FrontDeskRecordDrawer(props: {
  row: QueueRow;
  assignees: FrontDeskAssignee[];
  canWriteFlags: boolean;
  canWriteRestrictedFlags: boolean;
  onTransition(action: 'check_in' | 'check_out' | 'no_show'): Promise<void>;
  onCreateFlag(input: CreateFlagInput): Promise<void>;
  onAssignFlag(flagId: string, version: number, assignee?: string): Promise<void>;
  onResolveFlag(flagId: string, version: number, resolutionNote?: string): Promise<void>;
  onClose(): void;
}) {
  const [kind, setKind] = useState<BookingOperationalFlagKind>('late_checkout');
  const [severity, setSeverity] = useState<OperationalFlagSeverity>('attention');
  const [summary, setSummary] = useState('');
  const restricted = (RESTRICTED_FLAG_KINDS as readonly string[]).includes(kind);
  const canCreate = props.canWriteFlags && (!restricted || props.canWriteRestrictedFlags);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-stone-950/30" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) props.onClose(); }}>
      <aside className="h-full w-full max-w-xl overflow-y-auto bg-white p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="front-desk-record-title">
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Front desk record</p><h2 id="front-desk-record-title" className="mt-1 text-2xl font-semibold">{props.row.guestName}</h2><p className="text-sm text-stone-500">{props.row.confirmationCode} · {props.row.unitName}</p></div><button type="button" className="btn-secondary px-3 py-2" onClick={props.onClose} aria-label="Close record"><X className="h-4 w-4" /></button></div>
        <div className="mt-5 grid grid-cols-2 gap-3 rounded-xl bg-stone-50 p-4 text-sm"><div><span className="text-stone-500">Stay</span><p className="font-semibold">{props.row.checkIn} → {props.row.checkOut}</p></div><div><span className="text-stone-500">Balance</span><p className="font-semibold">${(props.row.balanceCents / 100).toFixed(2)}</p></div><div><span className="text-stone-500">Unit readiness</span><p className="font-semibold">{props.row.readiness.replaceAll('_', ' ')}</p></div><div><span className="text-stone-500">Party</span><p className="font-semibold">{props.row.partySize}</p></div></div>
        <div className="mt-5 flex flex-wrap gap-2">
          {props.row.status === 'confirmed' ? <><button type="button" className="btn-primary" onClick={() => void props.onTransition('check_in')}>Check in</button><button type="button" className="btn-secondary" onClick={() => void props.onTransition('no_show')}>Mark no-show</button></> : null}
          {props.row.status === 'checked_in' ? <button type="button" className="btn-primary" onClick={() => void props.onTransition('check_out')}>Check out</button> : null}
          <Link className="btn-secondary" to={`/admin/command?recordType=booking&recordId=${encodeURIComponent(props.row.bookingId)}`}>Open booking</Link>
          {props.row.housekeepingProgress ? <Link className="btn-secondary" to={`/admin/housekeeping?date=${encodeURIComponent(props.row.checkOut)}&assignment=${encodeURIComponent(props.row.housekeepingProgress.assignmentId)}`}>Open housekeeping</Link> : null}
        </div>
        <section className="mt-7 space-y-3"><h3 className="text-lg font-semibold">Open operational flags</h3>{props.row.openFlags.length === 0 ? <p className="text-sm text-stone-500">No open flags.</p> : props.row.openFlags.map((flag) => <div key={flag.flagId} className="rounded-xl border border-stone-200 p-3"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{flag.kind.replaceAll('_', ' ')}</p><p className="text-sm text-stone-600">{flag.summary}</p></div><span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">{flag.severity}</span></div>{props.canWriteFlags ? <div className="mt-3 flex flex-wrap gap-2"><select aria-label={`Assignee for ${flag.kind}`} className="field-input min-w-44 flex-1" value={flag.assignedStaffProfileId ?? ''} onChange={(event) => void props.onAssignFlag(flag.flagId, flag.version, event.target.value || undefined)}><option value="">Unassigned</option>{props.assignees.map((person) => <option key={person.profileId} value={person.profileId}>{person.name}</option>)}</select><button type="button" className="btn-secondary" onClick={() => void props.onResolveFlag(flag.flagId, flag.version)}>Resolve</button></div> : null}</div>)}</section>
        <section className="mt-7 border-t border-stone-200 pt-5"><h3 className="text-lg font-semibold">Add an operational flag</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><label><span className="field-label">Type</span><select className="field-input" value={kind} onChange={(event) => setKind(event.target.value as BookingOperationalFlagKind)}>{BOOKING_OPERATIONAL_FLAG_KINDS.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label><label><span className="field-label">Severity</span><select className="field-input" value={severity} onChange={(event) => setSeverity(event.target.value as OperationalFlagSeverity)}>{OPERATIONAL_FLAG_SEVERITIES.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label className="sm:col-span-2"><span className="field-label">Summary</span><input className="field-input" maxLength={160} value={summary} onChange={(event) => setSummary(event.target.value)} /></label></div>{restricted && !props.canWriteRestrictedFlags ? <p className="mt-2 text-sm text-amber-700">A manager or owner must create this restricted flag.</p> : null}<button type="button" className="btn-primary mt-3" disabled={!canCreate || !summary.trim()} onClick={() => { void props.onCreateFlag({ kind, severity, summary }); setSummary(''); }}>Add flag</button></section>
        {props.row.recentEvents.length ? <section className="mt-7 border-t border-stone-200 pt-5"><h3 className="text-lg font-semibold">Recent activity</h3><ol className="mt-3 space-y-2">{props.row.recentEvents.map((event, index) => <li key={`${event.ts}:${index}`} className="text-sm"><span className="font-semibold">{event.actorName}</span> {event.detail}<span className="block text-xs text-stone-500">{new Date(event.ts).toLocaleString()}</span></li>)}</ol></section> : null}
      </aside>
    </div>
  );
}
