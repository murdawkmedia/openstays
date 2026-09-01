import { Download, Printer } from 'lucide-react';

import { HOUSEKEEPING_CLEANING_TYPES } from '../../../shared/dailyOperations';
import type { HousekeepingViewState } from '../../lib/housekeepingViewState';
import type { HousekeepingAssignee } from './types';

export function HousekeepingToolbar(props: {
  state: HousekeepingViewState;
  counts: { board: number; assignments: number; audit: number };
  assignees: HousekeepingAssignee[];
  unitTypes: Array<{ id: string; name: string }>;
  unitGroups: Array<{ id: string; name: string }>;
  checklistsEnabled: boolean;
  onChange(patch: Partial<HousekeepingViewState>): void;
  onPrint(): void;
  onExport(): void;
}) {
  return <div className="space-y-4">
    <div className="card grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      <label><span className="field-label">Service date</span><input type="date" className="field-input" value={props.state.date} onChange={(event) => props.onChange({ date: event.target.value, record: undefined })} /></label>
      <label><span className="field-label">Service state</span><select className="field-input" value={props.state.state ?? ''} onChange={(event) => props.onChange({ state: event.target.value || undefined })}><option value="">Any state</option>{['ready', 'dirty', 'cleaning', 'inspection', 'do_not_disturb', 'out_of_service'].map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
      <label><span className="field-label">Cleaning</span><select className="field-input" value={props.state.cleaning ?? ''} onChange={(event) => props.onChange({ cleaning: event.target.value || undefined })}><option value="">Any type</option>{HOUSEKEEPING_CLEANING_TYPES.map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
      <label><span className="field-label">Assignee</span><select className="field-input" value={props.state.assignee ?? ''} onChange={(event) => props.onChange({ assignee: event.target.value || undefined })}><option value="">Anyone</option>{props.assignees.map((person) => <option key={person.profileId} value={person.profileId}>{person.name}</option>)}</select></label>
      <label><span className="field-label">Unit type</span><select className="field-input" value={props.state.unitType ?? ''} onChange={(event) => props.onChange({ unitType: event.target.value || undefined })}><option value="">All types</option>{props.unitTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label>
      <label><span className="field-label">Unit group</span><select className="field-input" value={props.state.unitGroup ?? ''} onChange={(event) => props.onChange({ unitGroup: event.target.value || undefined })}><option value="">All groups</option>{props.unitGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      <label><span className="field-label">Priority</span><input type="number" min="0" max="100" className="field-input" value={props.state.priority ?? ''} onChange={(event) => props.onChange({ priority: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex gap-2" role="tablist" aria-label="Housekeeping views">{(props.checklistsEnabled ? ['board', 'assignments', 'audit'] as const : ['board'] as const).map((view) => <button key={view} type="button" role="tab" aria-selected={props.state.view === view} className={`rounded-full px-4 py-2 text-sm font-semibold ${props.state.view === view ? 'bg-stone-950 text-white' : 'border border-stone-300 bg-white text-stone-700'}`} onClick={() => props.onChange({ view, record: undefined })}>{view} <span className="ml-1 opacity-75">{props.counts[view]}</span></button>)}</div><div className="flex gap-2"><button type="button" className="btn-secondary" onClick={props.onPrint}><Printer className="h-4 w-4" /> Print</button><button type="button" className="btn-secondary" onClick={props.onExport}><Download className="h-4 w-4" /> Export</button></div></div>
  </div>;
}
