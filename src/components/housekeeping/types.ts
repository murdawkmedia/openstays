export type HousekeepingAssignee = { profileId: string; name: string; role: string };

export type HousekeepingUnitRow = {
  unitId: string; unitName: string; unitTypeId: string; unitTypeName: string;
  unitGroups: Array<{ unitGroupId: string; name: string }>;
  sellableStatus: string; state: string; stateVersion: number;
  assignmentId?: string; assignedStaffProfileId?: string; assignmentStatus?: string;
  priority?: number; cleaningType?: string; expectedMinutes?: number; assignmentVersion?: number;
  checklist: { completed: number; total: number; requiredRemaining: number };
  lastCleanedAt?: number;
};

export type HousekeepingChecklistItem = {
  _id: string; itemKey: string; label: string; required: boolean; sortOrder: number;
  status: 'pending' | 'completed' | 'failed' | 'not_applicable'; note?: string; version: number;
};

export type HousekeepingAssignment = {
  _id: string; unitId: string; unitName: string; serviceDate: string; assignedStaffProfileId?: string;
  assigneeName?: string; priority: number; status: string; cleaningType?: string; customCleaningLabel?: string;
  expectedMinutes?: number; assignmentNote?: string; checklistTemplateId?: string; checklistTemplateVersion?: number;
  checklist: HousekeepingChecklistItem[]; inspectionResult?: 'passed' | 'failed'; inspectionNote?: string;
  startedAt?: number; completedAt?: number; verifiedAt?: number; version: number;
  serviceState: string; serviceVersion: number;
};

export type HousekeepingAuditRecord = HousekeepingAssignment & {
  actualMinutes?: number;
  events: Array<{ actorName: string; action: string; detail: string; ts: number }>;
};

export type HousekeepingTemplate = { _id: string; name: string; cleaningType: string; version: number };
