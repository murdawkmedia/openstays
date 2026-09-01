export const OPERATIONAL_ROLES = [
  'owner',
  'manager',
  'front_desk',
  'housekeeping',
  'accounting',
] as const;

export type OperationalRole = (typeof OPERATIONAL_ROLES)[number];

export const OPERATIONAL_CAPABILITIES = [
  'property.read',
  'property.configure',
  'staff.manage',
  'booking.read',
  'booking.write',
  'booking.check_in_out',
  'front_desk.flag.write',
  'front_desk.restricted_flag.write',
  'guest.read',
  'guest.message',
  'quote.write',
  'maintenance.read',
  'maintenance.write',
  'housekeeping.read',
  'housekeeping.assign',
  'housekeeping.update',
  'housekeeping.template.manage',
  'housekeeping.checklist.update',
  'housekeeping.verify',
  'folio.read',
  'folio.post',
  'refund.resolve',
  'complimentary.approve',
  'rate.adjust',
  'night_audit.close',
  'reports.read',
] as const;

export type OperationalCapability = (typeof OPERATIONAL_CAPABILITIES)[number];

const ALL_CAPABILITIES = Object.freeze([...OPERATIONAL_CAPABILITIES]);

const ROLE_CAPABILITIES: Readonly<Record<OperationalRole, readonly OperationalCapability[]>> = {
  owner: ALL_CAPABILITIES,
  manager: Object.freeze(OPERATIONAL_CAPABILITIES.filter((capability) => capability !== 'staff.manage')),
  front_desk: Object.freeze([
    'property.read',
    'booking.read',
    'booking.write',
    'booking.check_in_out',
    'front_desk.flag.write',
    'guest.read',
    'guest.message',
    'quote.write',
    'maintenance.read',
    'housekeeping.read',
    'folio.read',
    'folio.post',
    'reports.read',
  ]),
  housekeeping: Object.freeze([
    'property.read',
    'booking.read',
    'maintenance.read',
    'maintenance.write',
    'housekeeping.read',
    'housekeeping.assign',
    'housekeeping.update',
    'housekeeping.checklist.update',
  ]),
  accounting: Object.freeze([
    'property.read',
    'booking.read',
    'guest.read',
    'folio.read',
    'folio.post',
    'refund.resolve',
    'night_audit.close',
    'reports.read',
  ]),
};

export function capabilitiesForRole(role: OperationalRole): readonly OperationalCapability[] {
  return ROLE_CAPABILITIES[role];
}

export function roleCan(role: OperationalRole, capability: OperationalCapability): boolean {
  return ROLE_CAPABILITIES[role].includes(capability);
}
