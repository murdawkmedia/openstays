import { isIsoDate } from './pricing';

export const COMMAND_CENTER_HORIZONS = [30, 45, 60, 90] as const;
export type CommandCenterHorizon = (typeof COMMAND_CENTER_HORIZONS)[number];

export interface CommandCenterUnit {
  unitId: string;
  unitTypeId: string;
  groupIds: string[];
  attributes: {
    siteLengthFeet?: number;
    hookups?: string[];
    parkingStyle?: string;
    accessible?: boolean;
    petPolicy?: string;
  };
}

export interface CommandCenterBooking {
  bookingId: string;
  unitId: string;
  status: string;
  source: string;
  paymentStatus: string;
  attention: string[];
}

export interface CommandCenterFilters {
  unitTypeId?: string;
  unitGroupId?: string;
  hookup?: string;
  parkingStyle?: string;
  accessibleOnly?: boolean;
  status?: string;
  source?: string;
  paymentStatus?: string;
  attention?: string;
  occupancy?: 'occupied' | 'vacant';
}

export interface SavedCommandCenterView {
  startDate: string;
  days: CommandCenterHorizon;
  filters: CommandCenterFilters;
  search: string;
}

const STRING_FILTERS = [
  'unitTypeId',
  'unitGroupId',
  'hookup',
  'parkingStyle',
  'status',
  'source',
  'paymentStatus',
  'attention',
] as const satisfies readonly (keyof CommandCenterFilters)[];

export function parseSavedCommandCenterView(
  serialized: string | null,
  fallbackDate: string,
): SavedCommandCenterView {
  const fallback: SavedCommandCenterView = {
    startDate: fallbackDate,
    days: 45,
    filters: {},
    search: '',
  };
  if (!serialized) return fallback;
  try {
    const value = JSON.parse(serialized) as Record<string, unknown>;
    const rawFilters =
      value.filters && typeof value.filters === 'object'
        ? (value.filters as Record<string, unknown>)
        : {};
    const filters: CommandCenterFilters = {};
    for (const key of STRING_FILTERS) {
      const filter = rawFilters[key];
      if (typeof filter === 'string' && filter.length <= 100) filters[key] = filter;
    }
    if (typeof rawFilters.accessibleOnly === 'boolean') {
      filters.accessibleOnly = rawFilters.accessibleOnly;
    }
    if (rawFilters.occupancy === 'occupied' || rawFilters.occupancy === 'vacant') {
      filters.occupancy = rawFilters.occupancy;
    }
    return {
      startDate: typeof value.startDate === 'string' && isIsoDate(value.startDate)
        ? value.startDate
        : fallbackDate,
      days: typeof value.days === 'number' && COMMAND_CENTER_HORIZONS.includes(value.days as CommandCenterHorizon)
        ? value.days as CommandCenterHorizon
        : 45,
      filters,
      search: typeof value.search === 'string' ? value.search.slice(0, 200) : '',
    };
  } catch {
    return fallback;
  }
}

export function filterCommandCenterTape<
  TUnit extends CommandCenterUnit,
  TBooking extends CommandCenterBooking,
>(
  units: readonly TUnit[],
  bookings: readonly TBooking[],
  filters: CommandCenterFilters,
): { units: TUnit[]; bookings: TBooking[] } {
  const unitCandidates = units.filter((unit) => {
    if (filters.unitTypeId && unit.unitTypeId !== filters.unitTypeId) return false;
    if (filters.unitGroupId && !unit.groupIds.includes(filters.unitGroupId)) return false;
    if (filters.hookup && !unit.attributes.hookups?.includes(filters.hookup)) return false;
    if (filters.parkingStyle && unit.attributes.parkingStyle !== filters.parkingStyle) return false;
    if (filters.accessibleOnly && unit.attributes.accessible !== true) return false;
    return true;
  });
  const allowedUnits = new Set(unitCandidates.map((unit) => unit.unitId));
  const occupiedUnits = new Set(
    bookings.filter((booking) => allowedUnits.has(booking.unitId)).map((booking) => booking.unitId),
  );
  if (filters.occupancy === 'vacant') {
    return {
      units: unitCandidates.filter((unit) => !occupiedUnits.has(unit.unitId)),
      bookings: [],
    };
  }
  const hasBookingFilter = Boolean(
    filters.status || filters.source || filters.paymentStatus || filters.attention,
  );
  const matchingBookings = bookings.filter((booking) => {
    if (!allowedUnits.has(booking.unitId)) return false;
    if (filters.status && booking.status !== filters.status) return false;
    if (filters.source && booking.source !== filters.source) return false;
    if (filters.paymentStatus && booking.paymentStatus !== filters.paymentStatus) return false;
    if (filters.attention && !booking.attention.includes(filters.attention)) return false;
    return true;
  });

  if (!hasBookingFilter) {
    return {
      units: filters.occupancy === 'occupied'
        ? unitCandidates.filter((unit) => occupiedUnits.has(unit.unitId))
        : unitCandidates,
      bookings: matchingBookings,
    };
  }
  const unitsWithMatches = new Set(matchingBookings.map((booking) => booking.unitId));
  return {
    units: unitCandidates.filter((unit) => unitsWithMatches.has(unit.unitId)),
    bookings: matchingBookings,
  };
}
