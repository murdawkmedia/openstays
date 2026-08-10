import { useEffect, useState, type FormEvent } from 'react';
import { useMutation } from 'convex/react';
import { X } from 'lucide-react';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';

export type CommandAction = 'block' | 'call' | 'move' | 'resize' | 'complimentary' | 'rate';

type Unit = { unitId: string; unitTypeId: string; name: string };
type Booking = {
  bookingId: string;
  unitId: string;
  unitTypeId: string;
  checkIn: string;
  checkOut: string;
  confirmationCode: string;
  guestName: string;
  version: number;
  totalCents?: number;
};

export function CommandActionPanel({
  action,
  propertyId,
  units,
  booking,
  onClose,
}: {
  action: CommandAction;
  propertyId: Id<'properties'>;
  units: Unit[];
  booking: Booking | null;
  onClose: () => void;
}) {
  const createBlock = useMutation((api as any).operations.createBlock);
  const createCallTask = useMutation((api as any).operations.createCallTask);
  const moveBooking = useMutation((api as any).operations.moveBooking);
  const authorizeComplimentary = useMutation((api as any).operations.authorizeComplimentary);
  const adjustBookingRate = useMutation((api as any).operations.adjustBookingRate);
  const [unitId, setUnitId] = useState(booking?.unitId ?? units[0]?.unitId ?? '');
  const [checkIn, setCheckIn] = useState(booking?.checkIn ?? '');
  const [checkOut, setCheckOut] = useState(booking?.checkOut ?? '');
  const [title, setTitle] = useState(booking ? `Call ${booking.guestName}` : 'Guest follow-up');
  const [detail, setDetail] = useState('');
  const [reason, setReason] = useState('');
  const [adjustedDollars, setAdjustedDollars] = useState(
    booking?.totalCents === undefined ? '' : (booking.totalCents / 100).toFixed(2),
  );
  const [state, setState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  useEffect(() => {
    setUnitId(booking?.unitId ?? units[0]?.unitId ?? '');
    setCheckIn(booking?.checkIn ?? '');
    setCheckOut(booking?.checkOut ?? '');
  }, [action, booking, units]);

  const requiresBooking = ['move', 'resize', 'complimentary', 'rate'].includes(action);
  if (requiresBooking && !booking) return null;

  const heading = {
    block: 'Block inventory', call: 'Create call task', move: 'Move reservation', resize: 'Change stay dates',
    complimentary: 'Authorize complimentary stay', rate: 'Adjust reservation value',
  }[action];

  async function submit(event: FormEvent) {
    event.preventDefault();
    setState('working');
    setMessage('');
    try {
      const requestId = `staff:${action}:${crypto.randomUUID()}`;
      if (action === 'block') {
        await createBlock({ propertyId, unitId, checkIn, checkOut, reason, requestId });
      } else if (action === 'call') {
        await createCallTask({ propertyId, bookingId: booking?.bookingId, title, detail, requestId });
      } else if (action === 'move' || action === 'resize') {
        await moveBooking({ propertyId, bookingId: booking!.bookingId, targetUnitId: unitId, checkIn, checkOut, expectedVersion: booking!.version, requestId });
      } else if (action === 'complimentary') {
        await authorizeComplimentary({ propertyId, bookingId: booking!.bookingId, reason, requestId });
      } else {
        const adjustedTotalCents = Math.round(Number(adjustedDollars) * 100);
        if (!Number.isFinite(adjustedTotalCents)) throw new Error('Enter a valid adjusted total.');
        await adjustBookingRate({ propertyId, bookingId: booking!.bookingId, adjustedTotalCents, reason, requestId });
      }
      setState('done');
      setMessage('Saved and added to the audit trail.');
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'The operation could not be completed.');
    }
  }

  const compatibleUnits = booking ? units.filter((unit) => unit.unitTypeId === booking.unitTypeId) : units;
  return (
    <section className="card border-emerald-200 p-5" aria-labelledby="command-action-title">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Audited workflow</p><h2 id="command-action-title" className="mt-1 text-lg font-semibold text-stone-950">{heading}</h2></div>
        <button type="button" className="rounded-lg p-2 hover:bg-stone-100" onClick={onClose} aria-label="Close action"><X className="h-5 w-5" /></button>
      </div>
      <form className="mt-4 grid gap-4 md:grid-cols-2" onSubmit={(event) => void submit(event)}>
        {action === 'block' || action === 'move' || action === 'resize' ? (
          <label className="text-sm font-medium text-stone-700">Unit<select className="field-input mt-1" value={unitId} onChange={(event) => setUnitId(event.target.value)} required>{compatibleUnits.map((unit) => <option key={unit.unitId} value={unit.unitId}>{unit.name}</option>)}</select></label>
        ) : null}
        {action === 'block' || action === 'move' || action === 'resize' ? <><label className="text-sm font-medium text-stone-700">Arrival<input type="date" className="field-input mt-1" value={checkIn} onChange={(event) => setCheckIn(event.target.value)} required /></label><label className="text-sm font-medium text-stone-700">Departure<input type="date" className="field-input mt-1" value={checkOut} onChange={(event) => setCheckOut(event.target.value)} required /></label></> : null}
        {action === 'call' ? <><label className="text-sm font-medium text-stone-700">Task title<input className="field-input mt-1" value={title} onChange={(event) => setTitle(event.target.value)} required /></label><label className="text-sm font-medium text-stone-700 md:col-span-2">Call notes<textarea className="field-input mt-1 min-h-24" value={detail} onChange={(event) => setDetail(event.target.value)} /></label></> : null}
        {action === 'rate' ? <label className="text-sm font-medium text-stone-700">Adjusted total (dollars)<input inputMode="decimal" className="field-input mt-1" value={adjustedDollars} onChange={(event) => setAdjustedDollars(event.target.value)} required /></label> : null}
        {action === 'block' || action === 'complimentary' || action === 'rate' ? <label className="text-sm font-medium text-stone-700 md:col-span-2">Reason<textarea className="field-input mt-1 min-h-20" value={reason} onChange={(event) => setReason(event.target.value)} required /></label> : null}
        <div className="flex flex-wrap items-center gap-3 md:col-span-2">
          <button type="submit" className="btn-primary" disabled={state === 'working' || state === 'done'}>{state === 'working' ? 'Saving…' : state === 'done' ? 'Saved' : heading}</button>
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          {message ? <p className={`text-sm ${state === 'error' ? 'text-red-700' : 'text-emerald-700'}`} role="status">{message}</p> : null}
        </div>
      </form>
    </section>
  );
}
