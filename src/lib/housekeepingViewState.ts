import { isIsoDate, todayIso } from './dates';

export type HousekeepingView = 'board' | 'assignments' | 'audit';
export type HousekeepingViewState = {
  date: string;
  view: HousekeepingView;
  state?: string;
  unitGroup?: string;
  unitType?: string;
  assignee?: string;
  cleaning?: string;
  priority?: number;
  result?: 'passed' | 'failed';
  record?: string;
};

export function parseHousekeepingViewState(params: URLSearchParams, timezone?: string): HousekeepingViewState {
  const date = params.get('date');
  const view = params.get('view');
  const rawPriority = params.get('priority');
  const priority = rawPriority === null || rawPriority.trim() === '' ? Number.NaN : Number(rawPriority);
  const result = params.get('result');
  return {
    date: date && isIsoDate(date) ? date : todayIso(timezone),
    view: view === 'assignments' || view === 'audit' ? view : 'board',
    state: params.get('state') || undefined,
    unitGroup: params.get('group') || undefined,
    unitType: params.get('type') || undefined,
    assignee: params.get('assignee') || undefined,
    cleaning: params.get('cleaning') || undefined,
    priority: Number.isInteger(priority) && priority >= 0 ? priority : undefined,
    result: result === 'passed' || result === 'failed' ? result : undefined,
    record: params.get('record') || undefined,
  };
}

export function serializeHousekeepingViewState(state: HousekeepingViewState): URLSearchParams {
  const params = new URLSearchParams();
  params.set('date', state.date);
  params.set('view', state.view);
  if (state.state) params.set('state', state.state);
  if (state.unitGroup) params.set('group', state.unitGroup);
  if (state.unitType) params.set('type', state.unitType);
  if (state.assignee) params.set('assignee', state.assignee);
  if (state.cleaning) params.set('cleaning', state.cleaning);
  if (state.priority !== undefined) params.set('priority', String(state.priority));
  if (state.result) params.set('result', state.result);
  if (state.record) params.set('record', state.record);
  return params;
}
