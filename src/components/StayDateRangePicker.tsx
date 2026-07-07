import { DayPicker, type DateRange } from 'react-day-picker';
import { dateToIso, isoToDate, todayIso } from '../lib/dates';

export interface StayDateRangePickerProps {
  /** ISO date strings that must be disabled (at least one unit already booked that night). */
  fullyBlockedDates: Set<string>;
  range: { checkIn?: string; checkOut?: string };
  onChange: (range: { checkIn?: string; checkOut?: string }) => void;
}

/**
 * Thin wrapper around react-day-picker's range mode. Works entirely in ISO
 * date strings at the callsite boundary — Date objects never leak out.
 */
export function StayDateRangePicker({ fullyBlockedDates, range, onChange }: StayDateRangePickerProps) {
  const today = todayIso();
  const selected: DateRange | undefined = range.checkIn
    ? { from: isoToDate(range.checkIn), to: range.checkOut ? isoToDate(range.checkOut) : undefined }
    : undefined;

  return (
    <DayPicker
      mode="range"
      numberOfMonths={2}
      pagedNavigation
      selected={selected}
      onSelect={(next) => {
        if (!next) {
          onChange({ checkIn: undefined, checkOut: undefined });
          return;
        }
        onChange({
          checkIn: next.from ? dateToIso(next.from) : undefined,
          checkOut: next.to ? dateToIso(next.to) : undefined,
        });
      }}
      disabled={[{ before: isoToDate(today) }, (date) => fullyBlockedDates.has(dateToIso(date))]}
    />
  );
}
