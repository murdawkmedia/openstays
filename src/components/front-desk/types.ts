import type { BookingOperationalFlagKind, OperationalFlagSeverity } from '../../../shared/dailyOperations';

export type FrontDeskFlag = {
  flagId: string;
  kind: BookingOperationalFlagKind;
  severity: OperationalFlagSeverity;
  summary: string;
  dueAt?: number;
  assignedStaffProfileId?: string;
  version: number;
};

export type QueueRow = {
  bookingId: string;
  confirmationCode: string;
  guestName: string;
  unitName: string;
  checkIn: string;
  checkOut: string;
  status: string;
  partySize: number;
  readiness: string;
  balanceCents: number;
  openFlags: FrontDeskFlag[];
  housekeepingProgress?: { assignmentId: string; status: string; completed: number; total: number };
  expectedDepartureAt?: number;
  policySummary: { standardCheckInTime: string; standardCheckOutTime: string };
  recentEvents: Array<{ actorName: string; action: string; detail: string; ts: number }>;
  version: number;
};

export type FrontDeskAssignee = { profileId: string; name: string; role: string };

export type CreateFlagInput = {
  kind: BookingOperationalFlagKind;
  severity: OperationalFlagSeverity;
  summary: string;
  dueAt?: number;
  assignedStaffProfileId?: string;
};
