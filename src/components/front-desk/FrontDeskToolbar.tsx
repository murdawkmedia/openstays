import { ChevronLeft, ChevronRight, Download, Printer, Search } from 'lucide-react';

import { BOOKING_OPERATIONAL_FLAG_KINDS, FRONT_DESK_QUEUES, type FrontDeskQueue } from '../../../shared/dailyOperations';
import type { FrontDeskViewState } from '../../lib/frontDeskViewState';
import type { FrontDeskAssignee } from './types';

const LABELS: Record<FrontDeskQueue, string> = {
  arriving: 'Arriving', departing: 'Departing', stayingOver: 'Staying over', checkedIn: 'Checked in',
  noShow: 'No-show', checkedOut: 'Checked out', needsAttention: 'Needs attention',
};

export function FrontDeskToolbar(props: {
  state: FrontDeskViewState;
  counts: Record<FrontDeskQueue, number>;
  assignees: FrontDeskAssignee[];
  exceptionsEnabled: boolean;
  onChange(patch: Partial<FrontDeskViewState>): void;
  onPrevious(): void;
  onToday(): void;
  onNext(): void;
  onPrint(): void;
  onExport(): void;
}) {
  return (
    <div className="space-y-4">
      <div className="card grid gap-4 p-4 xl:grid-cols-[auto_minmax(14rem,1fr)_repeat(4,minmax(9rem,auto))] xl:items-end">
        <div>
          <span className="field-label">Business date</span>
          <div className="flex items-center gap-1">
            <button type="button" className="btn-secondary px-3 py-2" onClick={props.onPrevious} aria-label="Previous business date"><ChevronLeft className="h-4 w-4" /></button>
            <input aria-label="Business date" type="date" className="field-input min-w-40" value={props.state.date} onChange={(event) => props.onChange({ date: event.target.value, record: undefined })} />
            <button type="button" className="btn-secondary px-3 py-2" onClick={props.onNext} aria-label="Next business date"><ChevronRight className="h-4 w-4" /></button>
            <button type="button" className="btn-secondary px-3 py-2" onClick={props.onToday}>Today</button>
          </div>
        </div>
        <label>
          <span className="field-label">Find a guest, code, or unit</span>
          <span className="relative block"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-stone-400" /><input className="field-input pl-9" value={props.state.query} onChange={(event) => props.onChange({ query: event.target.value })} placeholder="Search this queue" /></span>
        </label>
        <label><span className="field-label">Readiness</span><select className="field-input" value={props.state.readiness ?? ''} onChange={(event) => props.onChange({ readiness: event.target.value || undefined })}><option value="">Any state</option>{['ready', 'dirty', 'cleaning', 'inspection', 'do_not_disturb', 'out_of_service'].map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
        <label><span className="field-label">Balance</span><select className="field-input" value={props.state.balance ?? ''} onChange={(event) => props.onChange({ balance: event.target.value as FrontDeskViewState['balance'] || undefined })}><option value="">Any balance</option><option value="open">Open</option><option value="settled">Settled</option></select></label>
        {props.exceptionsEnabled ? <label><span className="field-label">Flag</span><select className="field-input" value={props.state.flag ?? ''} onChange={(event) => props.onChange({ flag: event.target.value || undefined })}><option value="">Any flag</option>{BOOKING_OPERATIONAL_FLAG_KINDS.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label> : <div />}
        {props.exceptionsEnabled ? <label><span className="field-label">Flag assignee</span><select className="field-input" value={props.state.assignee ?? ''} onChange={(event) => props.onChange({ assignee: event.target.value || undefined })}><option value="">Anyone</option>{props.assignees.map((person) => <option key={person.profileId} value={person.profileId}>{person.name}</option>)}</select></label> : <div />}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Front-desk queues">
          {FRONT_DESK_QUEUES.map((queue) => <button key={queue} type="button" role="tab" aria-selected={props.state.queue === queue} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold ${props.state.queue === queue ? queue === 'needsAttention' ? 'bg-amber-700 text-white' : 'bg-stone-950 text-white' : 'border border-stone-300 bg-white text-stone-700'}`} onClick={() => props.onChange({ queue, record: undefined })}>{LABELS[queue]} <span className="ml-1 opacity-75">{props.counts[queue]}</span></button>)}
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="inline-flex rounded-lg border border-stone-300 bg-white p-1" aria-label="Record density">
            {(['compact', 'detailed'] as const).map((mode) => <button key={mode} type="button" className={`rounded-md px-3 py-1.5 text-sm font-semibold ${props.state.mode === mode ? 'bg-stone-900 text-white' : 'text-stone-600'}`} aria-pressed={props.state.mode === mode} onClick={() => props.onChange({ mode })}>{mode}</button>)}
          </div>
          <button type="button" className="btn-secondary" onClick={props.onPrint}><Printer className="h-4 w-4" /> Print</button>
          <button type="button" className="btn-secondary" onClick={props.onExport}><Download className="h-4 w-4" /> Export</button>
        </div>
      </div>
    </div>
  );
}
