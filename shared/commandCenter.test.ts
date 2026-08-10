import { describe, expect, it } from 'vitest';
import { COMMAND_CENTER_HORIZONS, filterCommandCenterTape } from './commandCenter';

const units = [
  {
    unitId: 'a',
    unitTypeId: 'rv',
    groupIds: ['big-rigs'],
    attributes: {
      siteLengthFeet: 45,
      hookups: ['50_amp', 'water'],
      parkingStyle: 'pull_through',
      accessible: true,
      petPolicy: 'allowed',
    },
  },
  {
    unitId: 'b',
    unitTypeId: 'tent',
    groupIds: ['quiet-loop'],
    attributes: { hookups: [], parkingStyle: 'back_in', accessible: false, petPolicy: 'restricted' },
  },
];

const bookings = [
  {
    bookingId: 'one',
    unitId: 'a',
    status: 'confirmed',
    source: 'phone',
    paymentStatus: 'paid',
    attention: [],
  },
  {
    bookingId: 'two',
    unitId: 'b',
    status: 'hold',
    source: 'online',
    paymentStatus: 'pending',
    attention: ['hold_expiring'],
  },
];

describe('command-center filters', () => {
  it('offers the accepted operational horizons', () => {
    expect(COMMAND_CENTER_HORIZONS).toEqual([30, 45, 60, 90]);
  });

  it('combines type, group, attribute, and payment filters', () => {
    const result = filterCommandCenterTape(units, bookings, {
      unitTypeId: 'rv',
      unitGroupId: 'big-rigs',
      hookup: '50_amp',
      parkingStyle: 'pull_through',
      accessibleOnly: true,
      paymentStatus: 'paid',
    });
    expect(result.units.map((unit) => unit.unitId)).toEqual(['a']);
    expect(result.bookings.map((booking) => booking.bookingId)).toEqual(['one']);
  });

  it('keeps units with matching operational attention even when booking filters are active', () => {
    const result = filterCommandCenterTape(units, bookings, {
      attention: 'hold_expiring',
      status: 'hold',
      source: 'online',
    });
    expect(result.units.map((unit) => unit.unitId)).toEqual(['b']);
    expect(result.bookings.map((booking) => booking.bookingId)).toEqual(['two']);
  });
});
