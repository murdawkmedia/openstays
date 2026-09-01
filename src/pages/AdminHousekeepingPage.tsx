import { useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { useSearchParams } from 'react-router-dom';

import { api } from '../../convex/_generated/api';
import type { ChecklistItemStatus } from '../../shared/dailyOperations';
import { useAdminProperty } from '../components/AdminShell';
import { HousekeepingAssignments } from '../components/housekeeping/HousekeepingAssignments';
import { HousekeepingAudit } from '../components/housekeeping/HousekeepingAudit';
import { HousekeepingBoard } from '../components/housekeeping/HousekeepingBoard';
import { HousekeepingChecklist } from '../components/housekeeping/HousekeepingChecklist';
import { HousekeepingToolbar } from '../components/housekeeping/HousekeepingToolbar';
import type { HousekeepingAssignee, HousekeepingAssignment, HousekeepingAuditRecord, HousekeepingTemplate, HousekeepingUnitRow } from '../components/housekeeping/types';
import { Spinner } from '../components/Spinner';
import { parseHousekeepingViewState, serializeHousekeepingViewState, type HousekeepingViewState } from '../lib/housekeepingViewState';

function csvValue(value: unknown) { return `"${String(value ?? '').replaceAll('"', '""')}"`; }

export function AdminHousekeepingPage() {
  const { property, enabledFeatures } = useAdminProperty();
  const [searchParams, setSearchParams] = useSearchParams();
  const [message, setMessage] = useState('');
  const enabled = enabledFeatures.includes('housekeeping');
  const checklistsEnabled = enabledFeatures.includes('housekeeping_checklists');
  const state = parseHousekeepingViewState(searchParams, property.timezone);
  const activeView = checklistsEnabled ? state.view : 'board';
  const activeState: HousekeepingViewState = { ...state, view: activeView };
  const needAssignments = checklistsEnabled && (activeView === 'assignments' || Boolean(state.record));
  const board = useQuery((api as any).housekeeping.board, enabled && activeView === 'board' ? { propertyId: property.propertyId, serviceDate: state.date } : 'skip') as { units: HousekeepingUnitRow[] } | undefined;
  const assignments = useQuery((api as any).housekeepingWork.listAssignments, needAssignments ? { propertyId: property.propertyId, serviceDate: state.date } : 'skip') as HousekeepingAssignment[] | undefined;
  const audit = useQuery((api as any).housekeepingWork.audit, checklistsEnabled && activeView === 'audit' ? { propertyId: property.propertyId, from: state.date, to: state.date, assignedStaffProfileId: state.assignee, cleaningType: state.cleaning, inspectionResult: state.result } : 'skip') as HousekeepingAuditRecord[] | undefined;
  const templates = useQuery((api as any).housekeepingTemplates.list, checklistsEnabled && Boolean(state.record) ? { propertyId: property.propertyId } : 'skip') as HousekeepingTemplate[] | undefined;
  const rawAssignees = useQuery((api as any).staff.propertyAssignees, enabled ? { propertyId: property.propertyId } : 'skip') as Array<{ staffProfileId: string; name: string; role: string }> | undefined;
  const assignees: HousekeepingAssignee[] = (rawAssignees ?? []).map((person) => ({ profileId: person.staffProfileId, name: person.name, role: person.role }));

  const assign = useMutation((api as any).housekeeping.assign);
  const transitionState = useMutation((api as any).housekeeping.transitionState);
  const attachTemplate = useMutation((api as any).housekeepingTemplates.attachToAssignment);
  const updateAssignment = useMutation((api as any).housekeepingWork.updateAssignment);
  const startAssignment = useMutation((api as any).housekeepingWork.start);
  const updateItem = useMutation((api as any).housekeepingWork.updateChecklistItem);
  const submitInspection = useMutation((api as any).housekeepingWork.submitForInspection);
  const reviewInspection = useMutation((api as any).housekeepingWork.reviewInspection);
  const cancelAssignment = useMutation((api as any).housekeepingWork.cancel);

  const filteredUnits = useMemo(() => (board?.units ?? []).filter((unit) =>
    (!state.state || unit.state === state.state) &&
    (!state.unitType || unit.unitTypeId === state.unitType) &&
    (!state.unitGroup || unit.unitGroups.some((group) => group.unitGroupId === state.unitGroup)) &&
    (!state.assignee || unit.assignedStaffProfileId === state.assignee) &&
    (!state.cleaning || unit.cleaningType === state.cleaning) &&
    (state.priority === undefined || unit.priority === state.priority),
  ), [board, state]);
  const filteredAssignments = useMemo(() => (assignments ?? []).filter((assignment) =>
    (!state.state || assignment.serviceState === state.state || assignment.status === state.state) &&
    (!state.assignee || assignment.assignedStaffProfileId === state.assignee) &&
    (!state.cleaning || assignment.cleaningType === state.cleaning) &&
    (state.priority === undefined || assignment.priority === state.priority),
  ), [assignments, state]);
  const filteredAudit = useMemo(() => (audit ?? []).filter((record) => !state.state || record.status === state.state || record.serviceState === state.state), [audit, state.state]);
  const selected = assignments?.find((assignment) => assignment._id === state.record);
  const unitTypes = Array.from(new Map((board?.units ?? []).map((unit) => [unit.unitTypeId, unit.unitTypeName])).entries()).map(([id, name]) => ({ id, name }));
  const unitGroups = Array.from(new Map((board?.units ?? []).flatMap((unit) => unit.unitGroups.map((group) => [group.unitGroupId, group.name] as const))).entries()).map(([id, name]) => ({ id, name }));
  const canAssign = property.capabilities.includes('housekeeping.assign');
  const canUpdate = property.capabilities.includes('housekeeping.checklist.update');
  const canVerify = property.capabilities.includes('housekeeping.verify');
  const canManageTemplates = property.capabilities.includes('housekeeping.template.manage');

  function change(patch: Partial<HousekeepingViewState>) {
    setSearchParams(serializeHousekeepingViewState({ ...state, ...patch }), { replace: true });
  }

  async function run(label: string, operation: () => Promise<unknown>) {
    setMessage('');
    try { await operation(); setMessage(label); }
    catch (error) {
      const detail = error instanceof Error ? error.message : 'The housekeeping update was not completed.';
      setMessage(detail.includes('VERSION_CONFLICT') ? 'This assignment changed on the server. Its current checklist remains open; review it and try again.' : detail);
    }
  }

  async function createWork(unit: HousekeepingUnitRow) {
    await run(`${unit.unitName} assignment created.`, async () => {
      const result = await assign({ propertyId: property.propertyId, unitId: unit.unitId, serviceDate: state.date, priority: 1, cleaningType: 'turnover', expectedMinutes: 45, requestId: crypto.randomUUID() });
      change({ record: result.assignmentId });
    });
  }

  async function advanceLegacy(unit: HousekeepingUnitRow, nextState: string) {
    await run(`${unit.unitName} updated.`, () => transitionState({ propertyId: property.propertyId, unitId: unit.unitId, state: nextState, expectedVersion: unit.stateVersion, requestId: crypto.randomUUID() }));
  }

  async function reassign(assignment: HousekeepingAssignment, assignee?: string) {
    await run('Assignment updated.', () => updateAssignment({ propertyId: property.propertyId, assignmentId: assignment._id, assignedStaffProfileId: assignee, priority: assignment.priority, cleaningType: assignment.cleaningType ?? 'turnover', customCleaningLabel: assignment.customCleaningLabel, expectedMinutes: assignment.expectedMinutes ?? 45, assignmentNote: assignment.assignmentNote, expectedVersion: assignment.version, requestId: crypto.randomUUID() }));
  }

  function exportCurrent() {
    const header = activeView === 'board' ? ['Unit', 'Type', 'State', 'Assignment', 'Cleaning', 'Checklist'] : ['Unit', 'Assignee', 'Status', 'Cleaning', 'Expected', 'Actual'];
    const records = activeView === 'board'
      ? filteredUnits.map((unit) => [unit.unitName, unit.unitTypeName, unit.state, unit.assignmentStatus, unit.cleaningType, `${unit.checklist.completed}/${unit.checklist.total}`])
      : (activeView === 'audit' ? filteredAudit : filteredAssignments).map((row) => [row.unitName, row.assigneeName, row.status, row.cleaningType, row.expectedMinutes, 'actualMinutes' in row ? row.actualMinutes : undefined]);
    const csv = [header, ...records].map((row) => row.map(csvValue).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${property.slug}-housekeeping-${state.view}-${state.date}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }

  if (!enabled) return <div className="card max-w-2xl p-6"><h1 className="text-2xl font-semibold">Housekeeping</h1><p className="mt-2 text-sm text-stone-600">Installed and protected by the <code>housekeeping</code> property flag.</p></div>;

  const loading = activeView === 'board' ? board === undefined : activeView === 'assignments' ? assignments === undefined : audit === undefined;
  return <div className="space-y-5">
    <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Service operations</p><h1 className="mt-1 text-2xl font-semibold">Housekeeping</h1><p className="mt-1 text-sm text-stone-600">Readiness stays separate from sellability. Only an explicit maintenance block removes inventory.</p></div>
    <HousekeepingToolbar state={activeState} counts={{ board: board?.units.length ?? 0, assignments: assignments?.length ?? 0, audit: audit?.length ?? 0 }} assignees={assignees} unitTypes={unitTypes} unitGroups={unitGroups} checklistsEnabled={checklistsEnabled} onChange={change} onPrint={() => window.print()} onExport={exportCurrent} />
    {!checklistsEnabled ? <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Checklist workflows are not enabled for this property. The original service-state board remains available.</p> : null}
    <p className={message ? 'rounded-lg bg-stone-900 px-4 py-3 text-sm text-white' : 'sr-only'} role="status" aria-live="polite">{message || 'Housekeeping ready.'}</p>
    {loading ? <Spinner label="Loading housekeeping…" /> : activeView === 'board' ? <HousekeepingBoard units={filteredUnits} selectedId={state.record} canAssign={canAssign} checklistsEnabled={checklistsEnabled} onSelect={(assignmentId) => change({ record: assignmentId })} onCreate={(unit) => void createWork(unit)} onAdvance={(unit, nextState) => void advanceLegacy(unit, nextState)} /> : activeView === 'assignments' ? <HousekeepingAssignments assignments={filteredAssignments} selectedId={state.record} onSelect={(assignment) => change({ record: assignment._id })} /> : <HousekeepingAudit records={filteredAudit} />}
    {selected && checklistsEnabled ? <HousekeepingChecklist assignment={selected} templates={templates ?? []} assignees={assignees} canAssign={canAssign} canUpdate={canUpdate} canVerify={canVerify} canManageTemplates={canManageTemplates} onAttach={(templateId) => run('Checklist attached.', () => attachTemplate({ propertyId: property.propertyId, assignmentId: selected._id, templateId, expectedAssignmentVersion: selected.version, requestId: crypto.randomUUID() }))} onReassign={(assignee) => reassign(selected, assignee)} onStart={() => run('Cleaning started.', () => startAssignment({ propertyId: property.propertyId, assignmentId: selected._id, expectedAssignmentVersion: selected.version, expectedServiceVersion: selected.serviceVersion, requestId: crypto.randomUUID() }))} onItemChange={(itemId, itemStatus: ChecklistItemStatus, itemVersion, note) => run('Checklist updated.', () => updateItem({ propertyId: property.propertyId, assignmentId: selected._id, itemId, status: itemStatus, note, expectedItemVersion: itemVersion, expectedAssignmentVersion: selected.version, requestId: crypto.randomUUID() }))} onSubmit={() => run('Ready for inspection.', () => submitInspection({ propertyId: property.propertyId, assignmentId: selected._id, expectedAssignmentVersion: selected.version, expectedServiceVersion: selected.serviceVersion, requestId: crypto.randomUUID() }))} onReview={(outcome, note) => run(outcome === 'passed' ? 'Unit verified ready.' : 'Returned to cleaning.', () => reviewInspection({ propertyId: property.propertyId, assignmentId: selected._id, outcome, note, expectedAssignmentVersion: selected.version, expectedServiceVersion: selected.serviceVersion, requestId: crypto.randomUUID() }))} onCancel={() => run('Assignment cancelled.', () => cancelAssignment({ propertyId: property.propertyId, assignmentId: selected._id, expectedVersion: selected.version, requestId: crypto.randomUUID() }))} onClose={() => change({ record: undefined })} /> : null}
  </div>;
}
