export const COMMAND_CENTER_HORIZONS = [30, 45, 60, 90] as const;

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

  if (!hasBookingFilter) return { units: unitCandidates, bookings: matchingBookings };
  const unitsWithMatches = new Set(matchingBookings.map((booking) => booking.unitId));
  return {
    units: unitCandidates.filter((unit) => unitsWithMatches.has(unit.unitId)),
    bookings: matchingBookings,
  };
}
