import { useMemo, useRef, useState } from 'react';
import { addDays, daysBetween } from '../../shared/pricing';

interface CommandUnit {
  unitId: string;
  name: string;
  status: string;
}

interface CommandBooking {
  bookingId: string;
  unitId: string;
  checkIn: string;
  checkOut: string;
  status: string;
  confirmationCode: string;
  guestName: string;
  paymentStatus: string;
}

const DAY_WIDTH = 42;
const UNIT_WIDTH = 168;
const ROW_HEIGHT = 48;
const VIEWPORT_HEIGHT = 520;
const OVERSCAN = 5;

const STATUS_COLORS: Record<string, string> = {
  hold: 'border-amber-400 bg-amber-100 text-amber-950',
  confirmed: 'border-emerald-500 bg-emerald-100 text-emerald-950',
  checked_in: 'border-teal-600 bg-teal-100 text-teal-950',
  external: 'border-sky-500 bg-sky-100 text-sky-950',
  blocked: 'border-stone-500 bg-stone-200 text-stone-900',
};

export function CommandBookingTape({
  startDate,
  days,
  units,
  bookings,
  onSelectBooking,
}: {
  startDate: string;
  days: number;
  units: CommandUnit[];
  bookings: CommandBooking[];
  onSelectBooking: (bookingId: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, end: Math.min(units.length, 18) });
  const dates = useMemo(() => Array.from({ length: days }, (_, index) => addDays(startDate, index)), [startDate, days]);
  const byUnit = useMemo(() => {
    const result = new Map<string, CommandBooking[]>();
    for (const booking of bookings) result.set(booking.unitId, [...(result.get(booking.unitId) ?? []), booking]);
    return result;
  }, [bookings]);
  const width = UNIT_WIDTH + days * DAY_WIDTH;

  function updateVisibleRows() {
    const element = scroller.current;
    if (!element) return;
    const start = Math.max(0, Math.floor(element.scrollTop / ROW_HEIGHT) - OVERSCAN);
    const end = Math.min(units.length, Math.ceil((element.scrollTop + element.clientHeight) / ROW_HEIGHT) + OVERSCAN);
    setRange({ start, end });
  }

  return (
    <div
      ref={scroller}
      className="relative overflow-auto rounded-xl border border-stone-200 bg-white"
      style={{ height: VIEWPORT_HEIGHT }}
      onScroll={updateVisibleRows}
      tabIndex={0}
      aria-label={`${days}-day reservation grid`}
    >
      <div style={{ width }}>
        <div className="sticky top-0 z-20 grid h-12 border-b border-stone-200 bg-stone-50" style={{ gridTemplateColumns: `${UNIT_WIDTH}px repeat(${days}, ${DAY_WIDTH}px)` }}>
          <div className="sticky left-0 z-30 border-r border-stone-200 bg-stone-50 px-3 py-3 text-xs font-semibold uppercase tracking-wide text-stone-500">Unit</div>
          {dates.map((date) => {
            const parsed = new Date(`${date}T00:00:00`);
            return <div key={date} className="border-r border-stone-200 px-1 py-1 text-center text-[10px] text-stone-500"><span className="block">{parsed.toLocaleDateString('en-CA', { weekday: 'narrow' })}</span><span className="font-semibold text-stone-800">{parsed.getDate()}</span></div>;
          })}
        </div>
        <div className="relative" style={{ height: units.length * ROW_HEIGHT }}>
          {units.slice(range.start, range.end).map((unit, visibleIndex) => {
            const rowIndex = range.start + visibleIndex;
            return (
              <div key={unit.unitId} className="absolute left-0 grid border-b border-stone-100" style={{ top: rowIndex * ROW_HEIGHT, height: ROW_HEIGHT, width, gridTemplateColumns: `${UNIT_WIDTH}px repeat(${days}, ${DAY_WIDTH}px)` }}>
                <div className="sticky left-0 z-10 truncate border-r border-stone-200 bg-white px-3 py-3 text-sm font-medium text-stone-800">{unit.name}</div>
                {dates.map((date) => <div key={date} className="border-r border-stone-100" />)}
                {(byUnit.get(unit.unitId) ?? []).map((booking) => {
                  const startOffset = Math.max(0, daysBetween(startDate, booking.checkIn));
                  const endOffset = Math.min(days, daysBetween(startDate, booking.checkOut));
                  if (endOffset <= 0 || startOffset >= days) return null;
                  return (
                    <button
                      type="button"
                      key={booking.bookingId}
                      className={`absolute top-2 h-8 overflow-hidden rounded-md border-l-4 px-2 text-left text-[11px] font-semibold shadow-sm focus:z-20 focus:outline-none focus:ring-2 focus:ring-emerald-600 ${STATUS_COLORS[booking.status] ?? 'border-stone-400 bg-stone-100 text-stone-900'}`}
                      style={{ left: UNIT_WIDTH + startOffset * DAY_WIDTH + 2, width: Math.max(34, (endOffset - startOffset) * DAY_WIDTH - 4) }}
                      title={`${booking.confirmationCode} · ${booking.guestName} · ${booking.paymentStatus}`}
                      onClick={() => onSelectBooking(booking.bookingId)}
                    >
                      <span className="block truncate">{booking.guestName}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
