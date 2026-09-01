import { FRONT_DESK_QUEUES, type FrontDeskMode, type FrontDeskQueue } from '../../shared/dailyOperations';
import { isIsoDate, todayIso } from './dates';

export type FrontDeskViewState = {
  date: string;
  queue: FrontDeskQueue;
  mode: FrontDeskMode;
  query: string;
  flag?: string;
  readiness?: string;
  balance?: 'open' | 'settled';
  assignee?: string;
  record?: string;
};

export type FrontDeskFilterRow = {
  bookingId: string;
  guestName: string;
  confirmationCode: string;
  unitName: string;
  readiness: string;
  balanceCents: number;
  openFlags: Array<{ kind: string; severity: string; assignedStaffProfileId?: string }>;
};

export function parseFrontDeskViewState(params: URLSearchParams, timezone?: string): FrontDeskViewState {
  const queue = params.get('queue');
  const date = params.get('date');
  const balance = params.get('balance');
  return {
    date: date && isIsoDate(date) ? date : todayIso(timezone),
    queue: FRONT_DESK_QUEUES.includes(queue as FrontDeskQueue) ? queue as FrontDeskQueue : 'arriving',
    mode: params.get('mode') === 'detailed' ? 'detailed' : 'compact',
    query: (params.get('q') ?? '').slice(0, 120),
    flag: params.get('flag') || undefined,
    readiness: params.get('readiness') || undefined,
    balance: balance === 'open' || balance === 'settled' ? balance : undefined,
    assignee: params.get('assignee') || undefined,
    record: params.get('record') || undefined,
  };
}

export function serializeFrontDeskViewState(state: FrontDeskViewState): URLSearchParams {
  const params = new URLSearchParams();
  params.set('date', state.date);
  params.set('queue', state.queue);
  params.set('mode', state.mode);
  if (state.query) params.set('q', state.query);
  if (state.flag) params.set('flag', state.flag);
  if (state.readiness) params.set('readiness', state.readiness);
  if (state.balance) params.set('balance', state.balance);
  if (state.assignee) params.set('assignee', state.assignee);
  if (state.record) params.set('record', state.record);
  return params;
}

export function filterFrontDeskRows<T extends FrontDeskFilterRow>(
  rows: readonly T[],
  filters: Pick<FrontDeskViewState, 'query' | 'flag' | 'readiness' | 'balance' | 'assignee'>,
): T[] {
  const query = filters.query.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    if (query && ![row.guestName, row.confirmationCode, row.unitName].join(' ').toLocaleLowerCase().includes(query)) return false;
    if (filters.flag && !row.openFlags.some((flag) => flag.kind === filters.flag)) return false;
    if (filters.readiness && row.readiness !== filters.readiness) return false;
    if (filters.balance === 'open' && row.balanceCents <= 0) return false;
    if (filters.balance === 'settled' && row.balanceCents > 0) return false;
    if (filters.assignee && !row.openFlags.some((flag) => flag.assignedStaffProfileId === filters.assignee)) return false;
    return true;
  });
}
