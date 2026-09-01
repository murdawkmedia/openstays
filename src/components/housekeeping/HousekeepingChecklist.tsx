import { X } from 'lucide-react';

import type { ChecklistItemStatus } from '../../../shared/dailyOperations';
import type { HousekeepingAssignee, HousekeepingAssignment, HousekeepingTemplate } from './types';

export function HousekeepingChecklist(props: {
  assignment: HousekeepingAssignment;
  templates: HousekeepingTemplate[];
  assignees: HousekeepingAssignee[];
  canAssign: boolean;
  canUpdate: boolean;
  canVerify: boolean;
  canManageTemplates: boolean;
  onAttach(templateId: string): Promise<void>;
  onReassign(assignee?: string): Promise<void>;
  onStart(): Promise<void>;
  onItemChange(itemId: string, status: ChecklistItemStatus, version: number, note?: string): Promise<void>;
  onSubmit(): Promise<void>;
  onReview(outcome: 'passed' | 'failed', note?: string): Promise<void>;
  onCancel(): Promise<void>;
  onClose(): void;
}) {
  const assignment = props.assignment;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-stone-950/30" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) props.onClose(); }}>
      <aside className="h-full w-full max-w-xl overflow-y-auto bg-white p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="housekeeping-work-title">
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Housekeeping work</p><h2 id="housekeeping-work-title" className="mt-1 text-2xl font-semibold">{assignment.unitName}</h2><p className="text-sm text-stone-500">{assignment.serviceDate} · {assignment.status.replaceAll('_', ' ')}</p></div><button type="button" className="btn-secondary px-3 py-2" onClick={props.onClose} aria-label="Close assignment"><X className="h-4 w-4" /></button></div>
        <dl className="mt-5 grid grid-cols-2 gap-3 rounded-xl bg-stone-50 p-4 text-sm">
          <div><dt className="text-stone-500">Assignee</dt><dd className="font-semibold">{props.canAssign && !['verified', 'cancelled'].includes(assignment.status) ? <select aria-label="Housekeeping assignee" className="field-input mt-1" value={assignment.assignedStaffProfileId ?? ''} onChange={(event) => void props.onReassign(event.target.value || undefined)}><option value="">Unassigned</option>{props.assignees.map((person) => <option key={person.profileId} value={person.profileId}>{person.name}</option>)}</select> : assignment.assigneeName ?? 'Unassigned'}</dd></div>
          <div><dt className="text-stone-500">Cleaning</dt><dd className="font-semibold">{assignment.cleaningType?.replaceAll('_', ' ') ?? '—'}</dd></div>
          <div><dt className="text-stone-500">Expected</dt><dd className="font-semibold">{assignment.expectedMinutes ? `${assignment.expectedMinutes} minutes` : '—'}</dd></div>
          <div><dt className="text-stone-500">Unit state</dt><dd className="font-semibold">{assignment.serviceState.replaceAll('_', ' ')}</dd></div>
        </dl>
        {assignment.checklist.length === 0 ? (
          <section className="mt-6"><h3 className="font-semibold">Checklist</h3><p className="mt-1 text-sm text-stone-500">Attach an approved template before work begins.</p>{props.canManageTemplates ? <div className="mt-3 flex flex-wrap gap-2">{props.templates.map((template) => <button key={template._id} type="button" className="btn-secondary" onClick={() => void props.onAttach(template._id)}>Use {template.name}</button>)}</div> : null}</section>
        ) : (
          <section className="mt-6"><h3 className="font-semibold">Checklist</h3><div className="mt-3 space-y-2">{assignment.checklist.map((item) => <div key={item._id} className="rounded-xl border border-stone-200 p-3"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{item.label}{item.required ? <span className="ml-1 text-red-700" aria-label="required">*</span> : null}</p>{item.note ? <p className="text-xs text-stone-500">{item.note}</p> : null}</div><select aria-label={`Status for ${item.label}`} className="field-input w-auto" value={item.status} disabled={!props.canUpdate || !['assigned', 'in_progress'].includes(assignment.status)} onChange={(event) => { const status = event.target.value as ChecklistItemStatus; const note = item.required && status === 'not_applicable' ? window.prompt('Required-item override reason') ?? undefined : undefined; void props.onItemChange(item._id, status, item.version, note); }}><option value="pending">Pending</option><option value="completed">Completed</option><option value="failed">Failed</option>{!item.required || props.canVerify ? <option value="not_applicable">Not applicable</option> : null}</select></div></div>)}</div></section>
        )}
        <div className="mt-6 flex flex-wrap gap-2">
          {assignment.status === 'assigned' && props.canUpdate ? <button type="button" className="btn-primary" disabled={!assignment.checklist.length} onClick={() => void props.onStart()}>Start cleaning</button> : null}
          {assignment.status === 'in_progress' && props.canUpdate ? <button type="button" className="btn-primary" onClick={() => void props.onSubmit()}>Submit for inspection</button> : null}
          {assignment.status === 'ready_for_inspection' && props.canVerify ? <><button type="button" className="btn-primary" onClick={() => void props.onReview('passed')}>Verify ready</button><button type="button" className="btn-secondary" onClick={() => { const note = window.prompt('What needs correction?') ?? undefined; if (note) void props.onReview('failed', note); }}>Return to cleaning</button></> : null}
          {!['verified', 'cancelled'].includes(assignment.status) && props.canVerify ? <button type="button" className="btn-secondary text-red-700" onClick={() => void props.onCancel()}>Cancel assignment</button> : null}
        </div>
      </aside>
    </div>
  );
}
