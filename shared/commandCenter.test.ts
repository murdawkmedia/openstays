import { describe, expect, it } from 'vitest';
import {
  COMMAND_CENTER_HORIZONS,
  filterCommandCenterTape,
  parseSavedCommandCenterView,
} from './commandCenter';

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

  it('filters occupied and vacant inventory independently of record status', () => {
    expect(filterCommandCenterTape(units, bookings, { occupancy: 'occupied' }).units.map((unit) => unit.unitId)).toEqual(['a', 'b']);
    expect(filterCommandCenterTape([...units, { ...units[1], unitId: 'c' }], bookings, { occupancy: 'vacant' }).units.map((unit) => unit.unitId)).toEqual(['c']);
  });

  it('restores only a validated property-scoped saved view', () => {
    expect(parseSavedCommandCenterView(JSON.stringify({
      startDate: '2030-07-01',
      days: 90,
      filters: { source: 'phone', occupancy: 'occupied', accessibleOnly: true, unexpected: 'discarded' },
      search: 'Ada',
    }), '2030-01-01')).toEqual({
      startDate: '2030-07-01',
      days: 90,
      filters: { source: 'phone', occupancy: 'occupied', accessibleOnly: true },
      search: 'Ada',
    });
  });

  it('falls back safely when a saved view is malformed', () => {
    expect(parseSavedCommandCenterView('{not-json', '2030-01-01')).toEqual({
      startDate: '2030-01-01', days: 45, filters: {}, search: '',
    });
    expect(parseSavedCommandCenterView(JSON.stringify({
      startDate: 'not-a-date', days: 365, filters: { occupancy: 'unknown', accessibleOnly: 'yes' }, search: 42,
    }), '2030-01-01')).toEqual({
      startDate: '2030-01-01', days: 45, filters: {}, search: '',
    });
  });
});
