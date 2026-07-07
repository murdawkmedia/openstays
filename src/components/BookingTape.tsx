import { addDays, daysBetween } from '../../shared/pricing';

export interface TapeUnit {
  unitId: string;
  name: string;
  status: string;
}

export interface TapeBooking {
  bookingId: string;
  unitId: string;
  checkIn: string;
  checkOut: string;
  status: string;
  confirmationCode: string;
  source: string;
}

export interface BookingTapeProps {
  startDate: string;
  days: number;
  units: TapeUnit[];
  bookings: TapeBooking[];
}

const STATUS_COLORS: Record<string, string> = {
  hold: 'bg-amber-400/80 text-amber-950',
  confirmed: 'bg-emerald-500/80 text-emerald-950',
  checked_in: 'bg-emerald-500/80 text-emerald-950',
  external: 'bg-sky-400/80 text-sky-950',
  blocked: 'bg-stone-400/80 text-stone-950',
};

const DAY_COL_WIDTH = 44;
const UNIT_COL_WIDTH = 140;

/**
 * CSS-grid booking tape: sticky unit-name column, one column per day, and
 * booking bars absolutely positioned to span [checkIn, checkOut). Convex
 * reactivity keeps this live-updating for free — no polling needed.
 */
export function BookingTape({ startDate, days, units, bookings }: BookingTapeProps) {
  const dates = Array.from({ length: days }, (_, i) => addDays(startDate, i));
  const bookingsByUnit = new Map<string, TapeBooking[]>();
  for (const booking of bookings) {
    const list = bookingsByUnit.get(booking.unitId) ?? [];
    list.push(booking);
    bookingsByUnit.set(booking.unitId, list);
  }

  const gridTemplateColumns = `${UNIT_COL_WIDTH}px repeat(${days}, ${DAY_COL_WIDTH}px)`;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-max">
        {/* Header row */}
        <div className="grid" style={{ gridTemplateColumns }}>
          <div className="sticky left-0 z-10 border-b border-r border-stone-200 bg-stone-50 px-3 py-2 text-xs font-semibold text-stone-500">
            Unit
          </div>
          {dates.map((date) => {
            const d = new Date(`${date}T00:00:00`);
            return (
              <div
                key={date}
                className="border-b border-stone-200 px-1 py-2 text-center text-[10px] leading-tight text-stone-500"
              >
                <div>{d.toLocaleDateString('en-CA', { weekday: 'narrow' })}</div>
                <div className="font-medium text-stone-700">{d.getDate()}</div>
              </div>
            );
          })}
        </div>

        {/* Unit rows */}
        {units.map((unit) => {
          const unitBookings = bookingsByUnit.get(unit.unitId) ?? [];
          return (
            <div key={unit.unitId} className="relative grid border-b border-stone-100" style={{ gridTemplateColumns }}>
              <div className="sticky left-0 z-10 truncate border-r border-stone-200 bg-white px-3 py-3 text-sm font-medium text-stone-700">
                {unit.name}
              </div>
              {dates.map((date) => (
                <div key={date} className="border-r border-stone-50 py-3" />
              ))}
              {unitBookings.map((booking) => {
                const startOffset = Math.max(0, daysBetween(startDate, booking.checkIn));
                const endOffset = Math.min(days, daysBetween(startDate, booking.checkOut));
                if (endOffset <= 0 || startOffset >= days) return null;
                const left = UNIT_COL_WIDTH + startOffset * DAY_COL_WIDTH;
                const width = (endOffset - startOffset) * DAY_COL_WIDTH;
                return (
                  <div
                    key={booking.bookingId}
                    title={`${booking.confirmationCode} · ${booking.status} · ${booking.checkIn} → ${booking.checkOut}`}
                    className={`absolute top-1.5 h-7 rounded-md px-2 text-[11px] font-medium leading-7 shadow-sm ${
                      STATUS_COLORS[booking.status] ?? 'bg-stone-300 text-stone-900'
                    }`}
                    style={{ left, width: width - 4 }}
                  >
                    <span className="truncate">{booking.confirmationCode}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
