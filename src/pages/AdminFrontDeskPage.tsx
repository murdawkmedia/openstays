import { useMemo, useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { Download, Printer, RefreshCw } from 'lucide-react';
import { api } from '../../convex/_generated/api';
import { useAdminProperty } from '../components/AdminShell';
import { Spinner } from '../components/Spinner';
import { todayIso } from '../lib/dates';

type QueueRow = {
  bookingId: string;
  confirmationCode: string;
  guestName: string;
  unitName: string;
  checkIn: string;
  checkOut: string;
  status: string;
  partySize: number;
  readiness: string;
  balanceCents: number;
  version: number;
};

type QueueKey = 'arriving' | 'departing' | 'stayingOver' | 'checkedIn' | 'noShow' | 'checkedOut';
const QUEUES: Array<{ key: QueueKey; label: string }> = [
  { key: 'arriving', label: 'Arriving' }, { key: 'departing', label: 'Departing' },
  { key: 'stayingOver', label: 'Staying over' }, { key: 'checkedIn', label: 'Checked in' },
  { key: 'noShow', label: 'No-show' }, { key: 'checkedOut', label: 'Checked out' },
];

export function AdminFrontDeskPage() {
  const { property, enabledFeatures } = useAdminProperty();
  const enabled = enabledFeatures.includes('front_desk');
  const [businessDate, setBusinessDate] = useState(todayIso());
  const [queue, setQueue] = useState<QueueKey>('arriving');
  const [message, setMessage] = useState<string | null>(null);
  const data = useQuery(api.frontDesk.queues, enabled ? { propertyId: property.propertyId, businessDate } : 'skip') as Record<QueueKey, QueueRow[]> | undefined;
  const transition = useMutation(api.frontDesk.transition);
  const rows = useMemo(() => data?.[queue] ?? [], [data, queue]);

  async function apply(row: QueueRow, action: 'check_in' | 'check_out' | 'no_show') {
    setMessage(null);
    try {
      await transition({ propertyId: property.propertyId, bookingId: row.bookingId as any, transition: action, expectedVersion: row.version, requestId: crypto.randomUUID() });
      setMessage(`${row.confirmationCode} updated.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The front-desk update was not completed.');
    }
  }

  function exportRows() {
    const csv = ['Confirmation,Guest,Unit,Arrival,Departure,Status,Balance cents', ...rows.map((row) => [row.confirmationCode, row.guestName, row.unitName, row.checkIn, row.checkOut, row.status, row.balanceCents].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(','))].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${property.slug}-${queue}-${businessDate}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }

  if (!enabled) return <div className="card max-w-2xl p-6"><h1 className="text-2xl font-semibold">Front desk</h1><p className="mt-2 text-sm text-stone-600">Installed and protected by the <code>front_desk</code> property flag. Enable it only after operational acceptance.</p></div>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Operations</p><h1 className="mt-1 text-2xl font-semibold">Front desk</h1></div><div className="flex gap-2"><button type="button" className="btn-secondary" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</button><button type="button" className="btn-secondary" onClick={exportRows}><Download className="h-4 w-4" /> Export</button></div></div>
      <div className="card p-4"><label className="field-label" htmlFor="front-desk-date">Business date</label><input id="front-desk-date" type="date" className="field-input max-w-52" value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} /></div>
      <div className="flex gap-2 overflow-x-auto" role="tablist" aria-label="Front-desk queues">{QUEUES.map((item) => <button key={item.key} type="button" role="tab" aria-selected={queue === item.key} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold ${queue === item.key ? 'bg-stone-950 text-white' : 'border border-stone-300 bg-white text-stone-700'}`} onClick={() => setQueue(item.key)}>{item.label} <span className="ml-1 opacity-70">{data?.[item.key].length ?? 0}</span></button>)}</div>
      {message ? <p className="rounded-lg bg-stone-900 px-4 py-3 text-sm text-white" role="status">{message}</p> : null}
      {data === undefined ? <Spinner label="Loading front desk…" /> : rows.length === 0 ? <div className="card p-8 text-center text-stone-500">No records in this queue.</div> : <div className="space-y-3">{rows.map((row) => <article key={row.bookingId} className="card grid gap-4 p-4 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(7rem,1fr))_auto] md:items-center"><div><p className="font-semibold text-stone-950">{row.guestName}</p><p className="text-sm text-stone-500">{row.confirmationCode} · {row.unitName} · party of {row.partySize}</p></div><div><p className="text-xs text-stone-500">Stay</p><p className="text-sm">{row.checkIn} → {row.checkOut}</p></div><div><p className="text-xs text-stone-500">Readiness</p><p className={`text-sm font-semibold ${row.readiness === 'ready' ? 'text-emerald-700' : 'text-amber-700'}`}>{row.readiness.replaceAll('_', ' ')}</p></div><div><p className="text-xs text-stone-500">Balance</p><p className="text-sm font-semibold">${(row.balanceCents / 100).toFixed(2)}</p></div><div className="flex flex-wrap gap-2">{row.status === 'confirmed' ? <><button type="button" className="btn-primary px-4 py-2" onClick={() => void apply(row, 'check_in')}>Check in</button><button type="button" className="btn-secondary px-4 py-2" onClick={() => void apply(row, 'no_show')}>No-show</button></> : null}{row.status === 'checked_in' ? <button type="button" className="btn-primary px-4 py-2" onClick={() => void apply(row, 'check_out')}>Check out</button> : null}{!['confirmed', 'checked_in'].includes(row.status) ? <RefreshCw className="h-4 w-4 text-stone-400" aria-label="Completed" /> : null}</div></article>)}</div>}
    </div>
  );
}
