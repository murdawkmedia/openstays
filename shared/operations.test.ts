import { describe, expect, it } from 'vitest';

import { capabilitiesForRole, roleCan } from './operations';

describe('operational role capabilities', () => {
  it('keeps ownership and security changes owner-only', () => {
    expect(roleCan('owner', 'staff.manage')).toBe(true);
    expect(roleCan('manager', 'staff.manage')).toBe(false);
    expect(roleCan('front_desk', 'staff.manage')).toBe(false);
    expect(roleCan('housekeeping', 'staff.manage')).toBe(false);
    expect(roleCan('accounting', 'staff.manage')).toBe(false);
  });

  it('allows managers to run operational workflows without ownership powers', () => {
    expect(roleCan('manager', 'booking.write')).toBe(true);
    expect(roleCan('manager', 'complimentary.approve')).toBe(true);
    expect(roleCan('manager', 'rate.adjust')).toBe(true);
    expect(roleCan('manager', 'property.configure')).toBe(true);
    expect(roleCan('manager', 'staff.manage')).toBe(false);
  });

  it('separates front desk, housekeeping, and accounting duties', () => {
    expect(roleCan('front_desk', 'booking.write')).toBe(true);
    expect(roleCan('front_desk', 'folio.post')).toBe(true);
    expect(roleCan('front_desk', 'housekeeping.assign')).toBe(false);
    expect(roleCan('front_desk', 'night_audit.close')).toBe(false);

    expect(roleCan('housekeeping', 'housekeeping.assign')).toBe(true);
    expect(roleCan('housekeeping', 'maintenance.write')).toBe(true);
    expect(roleCan('housekeeping', 'guest.read')).toBe(false);
    expect(roleCan('housekeeping', 'folio.post')).toBe(false);

    expect(roleCan('accounting', 'folio.post')).toBe(true);
    expect(roleCan('accounting', 'refund.resolve')).toBe(true);
    expect(roleCan('accounting', 'night_audit.close')).toBe(true);
    expect(roleCan('accounting', 'booking.write')).toBe(false);
  });

  it('grants focused daily-operations capabilities without widening roles', () => {
    expect(roleCan('front_desk', 'front_desk.flag.write')).toBe(true);
    expect(roleCan('front_desk', 'front_desk.restricted_flag.write')).toBe(false);
    expect(roleCan('housekeeping', 'housekeeping.checklist.update')).toBe(true);
    expect(roleCan('housekeeping', 'housekeeping.verify')).toBe(false);
    expect(roleCan('manager', 'housekeeping.template.manage')).toBe(true);
    expect(roleCan('accounting', 'front_desk.restricted_flag.write')).toBe(false);
  });

  it('returns an immutable capability collection', () => {
    const capabilities = capabilitiesForRole('front_desk');
    expect(capabilities).toContain('booking.read');
    expect(capabilities).toContain('booking.write');
    expect(Object.isFrozen(capabilities)).toBe(true);
  });
});
