import { useEffect, useMemo, useState } from 'react';
import { useQuery } from 'convex/react';
import { AlertTriangle, Bookmark, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { api } from '../../convex/_generated/api';
import { addDays } from '../../shared/pricing';
import {
  COMMAND_CENTER_HORIZONS,
  filterCommandCenterTape,
  type CommandCenterFilters,
} from '../../shared/commandCenter';
import { CommandBookingTape } from '../components/CommandBookingTape';
import { CommandActionPanel, type CommandAction } from '../components/CommandActionPanel';
import { useAdminProperty } from '../components/AdminShell';
import { Spinner } from '../components/Spinner';
import { todayIso } from '../lib/dates';

type Tape = {
  startDate: string;
  endDate: string;
  units: Array<{
    unitId: string;
    unitTypeId: string;
    name: string;
    status: string;
    groupIds: string[];
    attributes: {
      siteLengthFeet?: number;
      hookups?: string[];
      parkingStyle?: string;
      accessible?: boolean;
      petPolicy?: string;
    };
  }>;
  bookings: Array<{
    bookingId: string;
    unitId: string;
    unitTypeId: string;
    checkIn: string;
    checkOut: string;
    status: string;
    confirmationCode: string;
    source: string;
    guestName: string;
    adults: number;
    children: number;
    paymentStatus: string;
    attention: string[];
    version: number;
    totalCents?: number;
    updatedAt: number;
  }>;
  unitGroups: Array<{ unitGroupId: string; name: string }>;
  unitTypes: Array<{ unitTypeId: string; name: string }>;
};

export function AdminCommandPage() {
  const navigate = useNavigate();
  const { property, commandCenterEnabled } = useAdminProperty();
  const [startDate, setStartDate] = useState(todayIso());
  const [days, setDays] = useState<(typeof COMMAND_CENTER_HORIZONS)[number]>(45);
  const [filters, setFilters] = useState<CommandCenterFilters>({});
  const [search, setSearch] = useState('');
  const [selectedBookingId, setSelectedBookingId] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<CommandAction | null>(null);
  const tape = useQuery(api.availability.tapeForProperty, {
    propertyId: property.propertyId,
    startDate,
    days,
  }) as Tape | undefined;

  useEffect(() => {
    setSelectedBookingId(null);
    setFilters({});
    setSearch('');
    setActiveAction(null);
  }, [property.propertyId]);

  const filtered = useMemo(() => {
    if (!tape) return { units: [], bookings: [] };
    const base = filterCommandCenterTape(tape.units, tape.bookings, filters);
    const normalized = search.trim().toLowerCase();
    if (!normalized) return base;
    const matchingBookings = base.bookings.filter((booking) => {
      const unit = base.units.find((candidate) => candidate.unitId === booking.unitId);
      return [booking.confirmationCode, booking.guestName, booking.source, unit?.name]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalized));
    });
    const matchingUnitIds = new Set(matchingBookings.map((booking) => booking.unitId));
    const directUnitIds = new Set(
      base.units.filter((unit) => unit.name.toLowerCase().includes(normalized)).map((unit) => unit.unitId),
    );
    const visibleIds = new Set([...matchingUnitIds, ...directUnitIds]);
    return {
      units: base.units.filter((unit) => visibleIds.has(unit.unitId)),
      bookings: base.bookings.filter((booking) => visibleIds.has(booking.unitId)),
    };
  }, [tape, filters, search]);

  const selectedBooking = tape?.bookings.find((booking) => booking.bookingId === selectedBookingId) ?? null;

  function updateFilter<Key extends keyof CommandCenterFilters>(key: Key, value: CommandCenterFilters[Key]) {
    setFilters((current) => ({ ...current, [key]: value || undefined }));
  }

  function saveView() {
    localStorage.setItem(
      `openstays-command-view:${property.propertyId}`,
      JSON.stringify({ startDate, days, filters, search }),
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Operations</p>
          <h1 className="mt-1 text-2xl font-semibold text-stone-950">Reservation command center</h1>
          <p className="mt-1 text-sm text-stone-600">Inventory, guests, payments, and operational attention in one live view.</p>
        </div>
        <button type="button" className="btn-secondary" onClick={saveView}>
          <Bookmark className="h-4 w-4" aria-hidden="true" /> Save view
        </button>
      </div>

      {!commandCenterEnabled ? (
        <div className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          <div>
            <strong>Staged read-only preview.</strong> This property has not enabled the command-center feature flag. Live data is visible, but operational write actions stay locked.
          </div>
        </div>
      ) : null}

      <section className="card space-y-4 p-4" aria-label="Command-center controls">
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" disabled={!commandCenterEnabled} onClick={() => navigate('/admin/quotes?intent=reserve')}>Reserve</button>
          <button type="button" className="btn-secondary" disabled={!commandCenterEnabled} onClick={() => setActiveAction('block')}>Block</button>
          <button type="button" className="btn-secondary" disabled={!commandCenterEnabled} onClick={() => navigate('/admin/quotes?intent=quote')}>Quote</button>
          <button type="button" className="btn-secondary" disabled={!commandCenterEnabled} onClick={() => navigate('/admin/maintenance?intent=repair')}>Repair</button>
          <button type="button" className="btn-secondary" disabled={!commandCenterEnabled} onClick={() => setActiveAction('call')}>Call</button>
          <button type="button" className="btn-secondary" disabled={!commandCenterEnabled} onClick={() => navigate('/admin/folios?intent=retail')}>Retail</button>
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(15rem,2fr)_repeat(5,minmax(8rem,1fr))]">
          <label className="relative">
            <span className="sr-only">Search operations</span>
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-stone-400" aria-hidden="true" />
            <input className="field-input pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Guest, code, unit, source…" />
          </label>
          <select className="field-input" aria-label="Unit type" value={filters.unitTypeId ?? ''} onChange={(event) => updateFilter('unitTypeId', event.target.value)}>
            <option value="">All unit types</option>
            {tape?.unitTypes.map((type) => <option key={type.unitTypeId} value={type.unitTypeId}>{type.name}</option>)}
          </select>
          <select className="field-input" aria-label="Unit group" value={filters.unitGroupId ?? ''} onChange={(event) => updateFilter('unitGroupId', event.target.value)}>
            <option value="">All groups</option>
            {tape?.unitGroups.map((group) => <option key={group.unitGroupId} value={group.unitGroupId}>{group.name}</option>)}
          </select>
          <select className="field-input" aria-label="Stay status" value={filters.status ?? ''} onChange={(event) => updateFilter('status', event.target.value)}>
            <option value="">All stay states</option><option value="hold">Hold</option><option value="confirmed">Confirmed</option><option value="checked_in">Checked in</option><option value="blocked">Blocked</option><option value="external">External</option>
          </select>
          <select className="field-input" aria-label="Payment status" value={filters.paymentStatus ?? ''} onChange={(event) => updateFilter('paymentStatus', event.target.value)}>
            <option value="">All payments</option><option value="paid">Paid</option><option value="pending">Pending</option><option value="failed">Failed</option><option value="refunded">Refunded</option>
          </select>
          <select className="field-input" aria-label="Operational attention" value={filters.attention ?? ''} onChange={(event) => updateFilter('attention', event.target.value)}>
            <option value="">All attention</option><option value="hold_expiring">Expiring holds</option><option value="payment_review">Payment review</option><option value="sync_conflict">Channel conflicts</option>
          </select>
        </div>

        <details>
          <summary className="cursor-pointer text-sm font-semibold text-stone-700">Site attributes</summary>
          <div className="mt-3 flex flex-wrap gap-3">
            <select className="field-input max-w-48" aria-label="Hookup" value={filters.hookup ?? ''} onChange={(event) => updateFilter('hookup', event.target.value)}><option value="">Any hookup</option><option value="15_amp">15 amp</option><option value="30_amp">30 amp</option><option value="50_amp">50 amp</option><option value="water">Water</option><option value="sewer">Sewer</option></select>
            <select className="field-input max-w-48" aria-label="Parking style" value={filters.parkingStyle ?? ''} onChange={(event) => updateFilter('parkingStyle', event.target.value)}><option value="">Any site style</option><option value="back_in">Back-in</option><option value="pull_through">Pull-through</option></select>
            <label className="flex items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"><input type="checkbox" checked={filters.accessibleOnly ?? false} onChange={(event) => updateFilter('accessibleOnly', event.target.checked || undefined)} /> Accessible only</label>
            {Object.values(filters).some(Boolean) || search ? <button type="button" className="inline-flex items-center gap-1 text-sm font-semibold text-red-700" onClick={() => { setFilters({}); setSearch(''); }}><X className="h-4 w-4" /> Clear filters</button> : null}
          </div>
        </details>
      </section>

      {(activeAction === 'block' || activeAction === 'call') && !selectedBooking ? (
        <CommandActionPanel
          action={activeAction}
          propertyId={property.propertyId}
          units={tape?.units ?? []}
          booking={null}
          onClose={() => setActiveAction(null)}
        />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button type="button" className="btn-secondary px-3" aria-label="Previous period" onClick={() => setStartDate(addDays(startDate, -days))}><ChevronLeft className="h-4 w-4" /></button>
          <input type="date" className="field-input w-auto" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
          <button type="button" className="btn-secondary px-3" aria-label="Next period" onClick={() => setStartDate(addDays(startDate, days))}><ChevronRight className="h-4 w-4" /></button>
          <button type="button" className="text-sm font-semibold text-emerald-700" onClick={() => setStartDate(todayIso())}>Today</button>
        </div>
        <div className="flex rounded-lg border border-stone-300 bg-white p-1" aria-label="Grid horizon">
          {COMMAND_CENTER_HORIZONS.map((horizon) => <button key={horizon} type="button" className={`rounded-md px-3 py-1.5 text-sm font-semibold ${days === horizon ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-100'}`} onClick={() => setDays(horizon)}>{horizon}d</button>)}
        </div>
      </div>

      {tape === undefined ? <Spinner label="Loading reservation grid…" /> : (
        <>
          <p className="text-sm text-stone-600" aria-live="polite">Showing {filtered.units.length} units and {filtered.bookings.length} active records.</p>
          <CommandBookingTape startDate={tape.startDate} days={days} units={filtered.units} bookings={filtered.bookings} onSelectBooking={setSelectedBookingId} />
        </>
      )}

      {selectedBooking ? (
        <aside className="fixed inset-y-0 right-0 z-50 w-full max-w-md overflow-y-auto border-l border-stone-200 bg-white p-6 shadow-2xl" aria-label="Selected reservation" aria-live="polite">
          <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Reservation</p><h2 className="mt-1 text-xl font-semibold">{selectedBooking.confirmationCode}</h2></div><button type="button" className="rounded-lg p-2 hover:bg-stone-100" aria-label="Close reservation" onClick={() => { setSelectedBookingId(null); setActiveAction(null); }}><X className="h-5 w-5" /></button></div>
          <dl className="mt-6 grid grid-cols-2 gap-4 text-sm"><div><dt className="text-stone-500">Guest</dt><dd className="font-semibold text-stone-900">{selectedBooking.guestName}</dd></div><div><dt className="text-stone-500">Status</dt><dd className="font-semibold text-stone-900">{selectedBooking.status.replace('_', ' ')}</dd></div><div><dt className="text-stone-500">Arrival</dt><dd>{selectedBooking.checkIn}</dd></div><div><dt className="text-stone-500">Departure</dt><dd>{selectedBooking.checkOut}</dd></div><div><dt className="text-stone-500">Party</dt><dd>{selectedBooking.adults} adult{selectedBooking.adults === 1 ? '' : 's'} · {selectedBooking.children} children</dd></div><div><dt className="text-stone-500">Payment</dt><dd>{selectedBooking.paymentStatus}</dd></div></dl>
          {selectedBooking.attention.length ? <div className="mt-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-950"><strong>Needs attention:</strong> {selectedBooking.attention.join(', ').replaceAll('_', ' ')}</div> : null}
          <div className="mt-6 grid grid-cols-2 gap-2">
            <button type="button" className="btn-secondary" disabled={!commandCenterEnabled} onClick={() => setActiveAction('move')}>Move</button>
            <button type="button" className="btn-secondary" disabled={!commandCenterEnabled} onClick={() => setActiveAction('resize')}>Extend / shorten</button>
            <button type="button" className="btn-secondary" disabled={!commandCenterEnabled} onClick={() => setActiveAction('rate')}>Adjust rate</button>
            <button type="button" className="btn-secondary" disabled={!commandCenterEnabled} onClick={() => setActiveAction('complimentary')}>Complimentary</button>
            <button type="button" className="btn-secondary col-span-2" disabled={!commandCenterEnabled} onClick={() => setActiveAction('call')}>Create call task</button>
          </div>
          {activeAction && activeAction !== 'block' ? (
            <div className="mt-5">
              <CommandActionPanel
                action={activeAction}
                propertyId={property.propertyId}
                units={tape?.units ?? []}
                booking={selectedBooking}
                onClose={() => setActiveAction(null)}
              />
            </div>
          ) : null}
        </aside>
      ) : null}
    </div>
  );
}
