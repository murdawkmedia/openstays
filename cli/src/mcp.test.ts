import { describe, expect, it, vi } from 'vitest';
import { TOOL_DEFINITIONS } from './mcp.js';
import { ApiError, type OpenStaysClient } from './client.js';

const EXPECTED_TOOL_NAMES = [
  'openstays_health',
  'openstays_list_properties',
  'openstays_list_unit_types',
  'openstays_list_units',
  'openstays_list_rate_plans',
  'openstays_availability',
  'openstays_tape',
  'openstays_list_bookings',
  'openstays_get_booking',
  'openstays_create_hold',
  'openstays_cancel_booking',
  'openstays_promo_preview',
  'openstays_operations_view',
  'openstays_operations_action',
];

describe('MCP tool registry', () => {
  it('lists exactly the expected tool names', () => {
    const names = TOOL_DEFINITIONS.map((d) => d.tool.name).sort();
    expect(names).toEqual([...EXPECTED_TOOL_NAMES].sort());
  });

  it('every tool has a description and an object inputSchema', () => {
    for (const def of TOOL_DEFINITIONS) {
      expect(def.tool.description).toBeTruthy();
      expect(def.tool.inputSchema.type).toBe('object');
    }
  });

  it('routes openstays_availability to client.availability with mapped args', async () => {
    const def = TOOL_DEFINITIONS.find((d) => d.tool.name === 'openstays_availability')!;
    const availability = vi.fn().mockResolvedValue({ units: [], startDate: '2026-07-01', endDate: '2026-07-05' });
    const client = { availability } as unknown as OpenStaysClient;
    await def.run(client, { property: 'pinewood-flats', unitType: 'lakeview-cabin', from: '2026-07-01', to: '2026-07-05' });
    expect(availability).toHaveBeenCalledWith({
      property: 'pinewood-flats',
      unitType: 'lakeview-cabin',
      from: '2026-07-01',
      to: '2026-07-05',
    });
  });

  it('create_hold input schema exposes an optional addOns array', async () => {
    const def = TOOL_DEFINITIONS.find((d) => d.tool.name === 'openstays_create_hold')!;
    const props = def.tool.inputSchema.properties as Record<string, { type?: string }>;
    expect(props.addOns).toBeDefined();
    expect(props.addOns.type).toBe('array');
    // addOns is optional — not in the required list.
    expect(def.tool.inputSchema.required as string[]).not.toContain('addOns');
  });

  it('create_hold threads addOns through to the client when provided', async () => {
    const def = TOOL_DEFINITIONS.find((d) => d.tool.name === 'openstays_create_hold')!;
    const createHold = vi.fn().mockResolvedValue({ bookingId: 'b1', confirmationCode: 'OS-1' });
    const client = { createHold } as unknown as OpenStaysClient;
    await def.run(client, {
      unitId: 'u1',
      ratePlanId: 'r1',
      checkIn: '2026-07-01',
      checkOut: '2026-07-03',
      adults: 2,
      guestName: 'Sam Guest',
      guestEmail: 'sam@example.com',
      addOns: [{ addOnId: 'a1', quantity: 2 }],
    });
    expect(createHold).toHaveBeenCalledWith(
      expect.objectContaining({ addOns: [{ addOnId: 'a1', quantity: 2 }] }),
    );
  });

  it('routes openstays_create_hold to client.createHold with the guest object assembled', async () => {
    const def = TOOL_DEFINITIONS.find((d) => d.tool.name === 'openstays_create_hold')!;
    const createHold = vi.fn().mockResolvedValue({ bookingId: 'b1', confirmationCode: 'OS-1', status: 'hold' });
    const client = { createHold } as unknown as OpenStaysClient;
    await def.run(client, {
      unitId: 'u1',
      ratePlanId: 'r1',
      checkIn: '2026-07-01',
      checkOut: '2026-07-03',
      adults: 2,
      children: 0,
      guestName: 'Sam Guest',
      guestEmail: 'sam@example.com',
      guestPhone: '780-555-0100',
      marketingOptIn: true,
    });
    expect(createHold).toHaveBeenCalledWith({
      unitId: 'u1',
      ratePlanId: 'r1',
      checkIn: '2026-07-01',
      checkOut: '2026-07-03',
      adults: 2,
      children: 0,
      guest: { name: 'Sam Guest', email: 'sam@example.com', phone: '780-555-0100', marketingOptIn: true },
      addOns: [],
      promoCode: undefined,
    });
  });

  it('routes openstays_cancel_booking to client.cancelBooking', async () => {
    const def = TOOL_DEFINITIONS.find((d) => d.tool.name === 'openstays_cancel_booking')!;
    const cancelBooking = vi.fn().mockResolvedValue({ refundCents: 0, paidCents: 0 });
    const client = { cancelBooking } as unknown as OpenStaysClient;
    await def.run(client, { code: 'OS-ABC123', email: 'guest@example.com' });
    expect(cancelBooking).toHaveBeenCalledWith('OS-ABC123', { email: 'guest@example.com' });
  });

  it('routes openstays_get_booking to client.getBooking with the raw code', async () => {
    const def = TOOL_DEFINITIONS.find((d) => d.tool.name === 'openstays_get_booking')!;
    const getBooking = vi.fn().mockResolvedValue({ confirmationCode: 'OS-ABC123' });
    const client = { getBooking } as unknown as OpenStaysClient;
    await def.run(client, { code: 'OS-ABC123' });
    expect(getBooking).toHaveBeenCalledWith('OS-ABC123');
  });

  it('routes PMS views and actions without flattening their workflow payloads', async () => {
    const viewDef = TOOL_DEFINITIONS.find((d) => d.tool.name === 'openstays_operations_view')!;
    const actionDef = TOOL_DEFINITIONS.find((d) => d.tool.name === 'openstays_operations_action')!;
    const operationsView = vi.fn().mockResolvedValue({ records: [] });
    const operationsAction = vi.fn().mockResolvedValue({ replayed: false });
    const client = { operationsView, operationsAction } as unknown as OpenStaysClient;
    await viewDef.run(client, { property: 'kokanee', view: 'front-desk', date: '2030-08-10' });
    expect(operationsView).toHaveBeenCalledWith(expect.objectContaining({ property: 'kokanee', view: 'front-desk', date: '2030-08-10' }));
    await actionDef.run(client, { property: 'kokanee', action: 'front-desk/transition', requestId: 'req-1', input: { bookingId: 'b1', transition: 'check_in', expectedVersion: 0 } });
    expect(operationsAction).toHaveBeenCalledWith('front-desk/transition', { property: 'kokanee', requestId: 'req-1', bookingId: 'b1', transition: 'check_in', expectedVersion: 0 });
  });

  it('a tool run rejecting with ApiError propagates it (server maps to isError)', async () => {
    const def = TOOL_DEFINITIONS.find((d) => d.tool.name === 'openstays_get_booking')!;
    const getBooking = vi.fn().mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Booking not found.'));
    const client = { getBooking } as unknown as OpenStaysClient;
    await expect(def.run(client, { code: 'OS-NOPE' })).rejects.toBeInstanceOf(ApiError);
  });
});
