export const BOOKING_OPERATIONAL_FLAG_KINDS = [
  'late_checkout',
  'due_out',
  'departure_overdue',
  'lockout',
  'sleep_out',
  'payment_concern',
] as const;

export type BookingOperationalFlagKind = (typeof BOOKING_OPERATIONAL_FLAG_KINDS)[number];

export const RESTRICTED_FLAG_KINDS = ['lockout', 'payment_concern'] as const;

export type RestrictedFlagKind = (typeof RESTRICTED_FLAG_KINDS)[number];

export const OPERATIONAL_FLAG_SEVERITIES = ['info', 'attention', 'urgent'] as const;

export type OperationalFlagSeverity = (typeof OPERATIONAL_FLAG_SEVERITIES)[number];

export const HOUSEKEEPING_CLEANING_TYPES = [
  'turnover',
  'stayover',
  'inspection',
  'deep_clean',
  'custom',
] as const;

export type HousekeepingCleaningType = (typeof HOUSEKEEPING_CLEANING_TYPES)[number];

export const CHECKLIST_ITEM_STATUSES = [
  'pending',
  'completed',
  'failed',
  'not_applicable',
] as const;

export type ChecklistItemStatus = (typeof CHECKLIST_ITEM_STATUSES)[number];

export const FRONT_DESK_QUEUES = [
  'arriving',
  'departing',
  'stayingOver',
  'checkedIn',
  'noShow',
  'checkedOut',
  'needsAttention',
] as const;

export type FrontDeskQueue = (typeof FRONT_DESK_QUEUES)[number];
export type FrontDeskMode = 'compact' | 'detailed';

export function normalizeDailyOperationsText(value: string, maxLength: number): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length > maxLength) throw new Error('TEXT_TOO_LONG');
  return normalized;
}

export function parseFrontDeskQuery(params: URLSearchParams): {
  queue: FrontDeskQueue;
  mode: FrontDeskMode;
  selectedId?: string;
  query: string;
} {
  const queueValue = params.get('queue');
  const modeValue = params.get('mode');
  return {
    queue: FRONT_DESK_QUEUES.includes(queueValue as FrontDeskQueue)
      ? (queueValue as FrontDeskQueue)
      : 'arriving',
    mode: modeValue === 'detailed' ? 'detailed' : 'compact',
    selectedId: params.get('record') || undefined,
    query: (params.get('q') ?? '').slice(0, 120),
  };
}
