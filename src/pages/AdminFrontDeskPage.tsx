import { useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { useSearchParams } from 'react-router-dom';

import { api } from '../../convex/_generated/api';
import { FRONT_DESK_QUEUES, type FrontDeskQueue } from '../../shared/dailyOperations';
import { useAdminProperty } from '../components/AdminShell';
import { FrontDeskQueue as FrontDeskQueueList } from '../components/front-desk/FrontDeskQueue';
import { FrontDeskRecordDrawer } from '../components/front-desk/FrontDeskRecordDrawer';
import { FrontDeskToolbar } from '../components/front-desk/FrontDeskToolbar';
import type { CreateFlagInput, FrontDeskAssignee, QueueRow } from '../components/front-desk/types';
import { Spinner } from '../components/Spinner';
import { addDays, todayIso } from '../lib/dates';
import { filterFrontDeskRows, parseFrontDeskViewState, serializeFrontDeskViewState, type FrontDeskViewState } from '../lib/frontDeskViewState';

type QueueData = Record<FrontDeskQueue, QueueRow[]>;

function emptyCounts(): Record<FrontDeskQueue, number> {
  return Object.fromEntries(FRONT_DESK_QUEUES.map((queue) => [queue, 0])) as Record<FrontDeskQueue, number>;
}

export function AdminFrontDeskPage() {
  const { property, enabledFeatures } = useAdminProperty();
  const [searchParams, setSearchParams] = useSearchParams();
  const [message, setMessage] = useState('');
  const enabled = enabledFeatures.includes('front_desk');
  const exceptionsEnabled = enabledFeatures.includes('front_desk_exceptions');
  const state = parseFrontDeskViewState(searchParams, property.timezone);
  const data = useQuery((api as any).frontDesk.queues, enabled ? { propertyId: property.propertyId, businessDate: state.date } : 'skip') as QueueData | undefined;
  const rawAssignees = useQuery((api as any).staff.propertyAssignees, exceptionsEnabled ? { propertyId: property.propertyId } : 'skip') as Array<{ staffProfileId: string; name: string; role: string }> | undefined;
  const assignees: FrontDeskAssignee[] = (rawAssignees ?? []).map((person) => ({ profileId: person.staffProfileId, name: person.name, role: person.role }));
  const transition = useMutation((api as any).frontDesk.transition);
  const createFlag = useMutation((api as any).operationalFlags.create);
  const assignFlag = useMutation((api as any).operationalFlags.assign);
  const resolveFlag = useMutation((api as any).operationalFlags.resolve);
  const rows = useMemo(() => filterFrontDeskRows(data?.[state.queue] ?? [], state), [data, state]);
  const counts = useMemo(() => data ? Object.fromEntries(FRONT_DESK_QUEUES.map((queue) => [queue, data[queue].length])) as Record<FrontDeskQueue, number> : emptyCounts(), [data]);
  const selected = useMemo(() => {
    if (!state.record || !data) return undefined;
    for (const queue of FRONT_DESK_QUEUES) {
      const match = data[queue].find((row) => row.bookingId === state.record);
      if (match) return match;
    }
    return undefined;
  }, [data, state.record]);
  const canWriteFlags = property.capabilities.includes('front_desk.flag.write');
  const canWriteRestrictedFlags = property.capabilities.includes('front_desk.restricted_flag.write');

  function change(patch: Partial<FrontDeskViewState>) {
    setSearchParams(serializeFrontDeskViewState({ ...state, ...patch }), { replace: true });
  }

  async function run(label: string, operation: () => Promise<unknown>) {
    setMessage('');
    try {
      await operation();
      setMessage(label);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'The operation was not completed.';
      setMessage(detail.includes('VERSION_CONFLICT') ? 'This record changed on the server. Its current details are still open; review them and try again.' : detail);
    }
  }

  async function apply(row: QueueRow, action: 'check_in' | 'check_out' | 'no_show') {
    await run(`${row.confirmationCode} updated.`, () => transition({ propertyId: property.propertyId, bookingId: row.bookingId, transition: action, expectedVersion: row.version, requestId: crypto.randomUUID() }));
  }

  async function addFlag(row: QueueRow, input: CreateFlagInput) {
    await run('Operational flag added.', () => createFlag({ propertyId: property.propertyId, bookingId: row.bookingId, ...input, expectedBookingVersion: row.version, requestId: crypto.randomUUID() }));
  }

  async function updateFlagAssignee(flagId: string, version: number, assignee?: string) {
    await run('Flag assignment updated.', () => assignFlag({ propertyId: property.propertyId, flagId, assignedStaffProfileId: assignee, expectedVersion: version, requestId: crypto.randomUUID() }));
  }

  async function closeFlag(flagId: string, version: number, resolutionNote?: string) {
    await run('Operational flag resolved.', () => resolveFlag({ propertyId: property.propertyId, flagId, expectedVersion: version, resolutionNote, requestId: crypto.randomUUID() }));
  }

  function exportRows() {
    const csv = ['Confirmation,Guest,Unit,Arrival,Departure,Status,Readiness,Balance cents,Flags', ...rows.map((row) => [row.confirmationCode, row.guestName, row.unitName, row.checkIn, row.checkOut, row.status, row.readiness, row.balanceCents, row.openFlags.map((flag) => flag.kind).join('|')].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${property.slug}-${state.queue}-${state.date}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  if (!enabled) return <div className="card max-w-2xl p-6"><h1 className="text-2xl font-semibold">Front desk</h1><p className="mt-2 text-sm text-stone-600">Installed and protected by the <code>front_desk</code> property flag. Enable it only after operational acceptance.</p></div>;

  return (
    <div className="space-y-5">
      <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Operations</p><h1 className="mt-1 text-2xl font-semibold">Front desk</h1><p className="mt-1 text-sm text-stone-600">One day of arrivals, departures, exceptions, readiness, and balances. Select a record for safe actions.</p></div>
      <FrontDeskToolbar
        state={state}
        counts={counts}
        assignees={assignees}
        exceptionsEnabled={exceptionsEnabled}
        onChange={change}
        onPrevious={() => change({ date: addDays(state.date, -1), record: undefined })}
        onToday={() => change({ date: todayIso(property.timezone), record: undefined })}
        onNext={() => change({ date: addDays(state.date, 1), record: undefined })}
        onPrint={() => window.print()}
        onExport={exportRows}
      />
      <p className={message ? 'rounded-lg bg-stone-900 px-4 py-3 text-sm text-white' : 'sr-only'} role="status" aria-live="polite">{message || 'Front desk ready.'}</p>
      {data === undefined ? <Spinner label="Loading front desk…" /> : <FrontDeskQueueList rows={rows} mode={state.mode} onSelect={(row) => change({ record: row.bookingId })} />}
      {selected ? <FrontDeskRecordDrawer row={selected} assignees={assignees} canWriteFlags={canWriteFlags} canWriteRestrictedFlags={canWriteRestrictedFlags} onTransition={(action) => apply(selected, action)} onCreateFlag={(input) => addFlag(selected, input)} onAssignFlag={updateFlagAssignee} onResolveFlag={closeFlag} onClose={() => change({ record: undefined })} /> : null}
    </div>
  );
}
