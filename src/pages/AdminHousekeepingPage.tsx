import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { useAdminProperty } from '../components/AdminShell';
import { Spinner } from '../components/Spinner';
import { todayIso } from '../lib/dates';

type UnitRow = { unitId: string; unitName: string; state: string; stateVersion: number; assignedStaffProfileId?: string; assignmentStatus?: string; priority?: number };
const NEXT_STATE: Record<string, { state: any; label: string }> = {
  dirty: { state: 'cleaning', label: 'Start cleaning' },
  cleaning: { state: 'inspection', label: 'Ready for inspection' },
  inspection: { state: 'ready', label: 'Verify ready' },
  do_not_disturb: { state: 'dirty', label: 'Return to queue' },
  out_of_service: { state: 'dirty', label: 'Return to service' },
};

export function AdminHousekeepingPage() {
  const { property, enabledFeatures } = useAdminProperty();
  const enabled = enabledFeatures.includes('housekeeping');
  const [serviceDate, setServiceDate] = useState(todayIso());
  const [message, setMessage] = useState<string | null>(null);
  const board = useQuery(api.housekeeping.board, enabled ? { propertyId: property.propertyId, serviceDate } : 'skip') as { units: UnitRow[] } | undefined;
  const transition = useMutation(api.housekeeping.transitionState);

  async function advance(unit: UnitRow, state: any) {
    setMessage(null);
    try {
      await transition({ propertyId: property.propertyId, unitId: unit.unitId as any, state, expectedVersion: unit.stateVersion, requestId: crypto.randomUUID() });
      setMessage(`${unit.unitName} updated to ${String(state).replaceAll('_', ' ')}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Update failed.'); }
  }

  if (!enabled) return <div className="card max-w-2xl p-6"><h1 className="text-2xl font-semibold">Housekeeping</h1><p className="mt-2 text-sm text-stone-600">Installed and protected by the <code>housekeeping</code> property flag.</p></div>;
  return <div className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Service operations</p><h1 className="mt-1 text-2xl font-semibold">Housekeeping board</h1></div><label><span className="field-label">Service date</span><input type="date" className="field-input" value={serviceDate} onChange={(event) => setServiceDate(event.target.value)} /></label></div>{message ? <p className="rounded-lg bg-stone-900 px-4 py-3 text-sm text-white" role="status">{message}</p> : null}{board === undefined ? <Spinner label="Loading housekeeping…" /> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{board.units.map((unit) => { const next = NEXT_STATE[unit.state]; return <article key={unit.unitId} className="card p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-stone-950">{unit.unitName}</h2><p className="mt-1 text-sm capitalize text-stone-500">{unit.state.replaceAll('_', ' ')}</p></div><span className={`rounded-full px-2 py-1 text-xs font-semibold ${unit.state === 'ready' ? 'bg-emerald-100 text-emerald-800' : unit.state === 'out_of_service' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'}`}>{unit.assignmentStatus ?? 'Unassigned'}</span></div><div className="mt-4 flex flex-wrap gap-2">{next ? <button type="button" className="btn-primary px-4 py-2" onClick={() => void advance(unit, next.state)}>{next.label}</button> : null}{unit.state === 'ready' ? <button type="button" className="btn-secondary px-4 py-2" onClick={() => void advance(unit, 'do_not_disturb')}>Do not disturb</button> : null}</div></article>; })}</div>}</div>;
}
