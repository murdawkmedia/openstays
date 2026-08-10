import { useMemo, useState } from 'react';
import {
  BedDouble,
  Bitcoin,
  CalendarClock,
  CircleDollarSign,
  ExternalLink,
  FileCheck2,
  MessageSquareText,
  Network,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import {
  PUBLIC_OPERATIONS_FIXTURE,
  type PublicOperationKind,
  type PublicOperationRecord,
} from '../fixtures/publicOperationsFixture';

const KIND_LABELS: Record<PublicOperationKind | 'all', string> = {
  all: 'All records',
  hold: 'Holds',
  booking: 'Bookings',
  payment: 'Payments',
  message: 'Messages',
  refund: 'Refunds',
  receipt: 'Receipts',
  reward: 'Rewards',
  channel: 'Channels',
  treasury: 'Treasury',
  front_desk: 'Front desk',
  housekeeping: 'Housekeeping',
  maintenance: 'Maintenance',
  folio: 'Folios',
  quote: 'Quotes',
  group: 'Groups',
  report: 'Reports',
};

const KIND_ICONS: Record<PublicOperationKind, typeof BedDouble> = {
  hold: CalendarClock,
  booking: BedDouble,
  payment: CircleDollarSign,
  message: MessageSquareText,
  refund: RotateCcw,
  receipt: FileCheck2,
  reward: Bitcoin,
  channel: Network,
  treasury: WalletCards,
  front_desk: BedDouble,
  housekeeping: RefreshCw,
  maintenance: RefreshCw,
  folio: CircleDollarSign,
  quote: FileCheck2,
  group: MessageSquareText,
  report: CalendarClock,
};

type ViewMode = 'queue' | 'consensus';

function RecordRow({
  record,
  selected,
  onSelect,
}: {
  record: PublicOperationRecord;
  selected: boolean;
  onSelect: () => void;
}) {
  const Icon = KIND_ICONS[record.kind];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`w-full rounded-xl border p-4 text-left transition ${
        selected
          ? 'border-emerald-500 bg-emerald-50 shadow-sm'
          : 'border-stone-200 bg-white hover:border-stone-300'
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded-lg bg-stone-100 p-2 text-stone-600">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="font-semibold text-stone-900">{record.title}</span>
            <span className="text-xs text-stone-500">{record.updatedLabel}</span>
          </span>
          <span className="mt-1 block text-sm text-stone-600">{record.summary}</span>
          <span className="mt-2 inline-flex rounded-full bg-stone-100 px-2.5 py-1 text-xs font-semibold text-stone-700">
            {record.status}
          </span>
        </span>
      </div>
    </button>
  );
}

export function PublicOperationsTourPage() {
  const [kind, setKind] = useState<PublicOperationKind | 'all'>('all');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<ViewMode>('queue');
  const [selectedId, setSelectedId] = useState(PUBLIC_OPERATIONS_FIXTURE.records[0].id);

  const records = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return PUBLIC_OPERATIONS_FIXTURE.records.filter((record) => {
      if (kind !== 'all' && record.kind !== kind) return false;
      if (!normalized) return true;
      return [record.title, record.status, record.summary, record.kind]
        .join(' ')
        .toLowerCase()
        .includes(normalized);
    });
  }, [kind, query]);

  const selected = PUBLIC_OPERATIONS_FIXTURE.records.find((record) => record.id === selectedId)
    ?? records[0]
    ?? PUBLIC_OPERATIONS_FIXTURE.records[0];

  return (
    <div className="space-y-6">
      <section
        className="flex flex-col gap-4 rounded-2xl border border-amber-300 bg-amber-50 p-5 sm:flex-row sm:items-center sm:justify-between"
        aria-label="Read-only fictional demo"
      >
        <div>
          <p className="font-semibold text-amber-950">{PUBLIC_OPERATIONS_FIXTURE.notice}</p>
          <p className="mt-1 text-sm text-amber-900">
            Curated sample records only. This tour never queries production bookings or exposes guest data.
          </p>
        </div>
        <Link to="/admin/login" className="btn-secondary shrink-0">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          Staff sign in
        </Link>
      </section>

      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">
          Operations tour
        </p>
        <h1 className="font-display text-3xl font-semibold text-stone-950 sm:text-4xl">
          See how a stay reaches consensus
        </h1>
        <p className="max-w-3xl text-stone-600">
          Explore the booking tape, payment authority, messages, timestamp receipts, rewards,
          refunds, and channel readiness behind the fictional Consensus Commons property.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Sample metrics">
        {PUBLIC_OPERATIONS_FIXTURE.metrics.map((metric) => (
          <article key={metric.label} className="card p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{metric.label}</p>
            <p className="mt-2 text-2xl font-semibold text-stone-950">{metric.value}</p>
            <p className="mt-1 text-xs text-stone-500">{metric.note}</p>
          </article>
        ))}
      </section>

      <section className="card overflow-hidden">
        <div className="border-b border-stone-200 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="inline-flex w-fit rounded-lg bg-stone-100 p-1 text-sm font-medium">
              <button
                type="button"
                onClick={() => setView('queue')}
                className={`rounded-md px-3 py-1.5 ${view === 'queue' ? 'bg-white shadow-sm' : 'text-stone-500'}`}
              >
                Operations queue
              </button>
              <button
                type="button"
                onClick={() => setView('consensus')}
                className={`rounded-md px-3 py-1.5 ${view === 'consensus' ? 'bg-white shadow-sm' : 'text-stone-500'}`}
              >
                Consensus states
              </button>
            </div>
            <label className="relative block w-full lg:max-w-xs">
              <span className="sr-only">Search fictional operations</span>
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-stone-400" aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="field-input py-2 pl-9"
                placeholder="Search sample records"
              />
            </label>
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Filter record type">
            {(Object.keys(KIND_LABELS) as Array<PublicOperationKind | 'all'>).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setKind(option)}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${
                  kind === option
                    ? 'bg-stone-900 text-white'
                    : 'border border-stone-200 bg-white text-stone-600 hover:border-stone-400'
                }`}
              >
                {KIND_LABELS[option]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid min-h-[32rem] lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
          <div className="space-y-3 border-b border-stone-200 bg-stone-50 p-4 lg:border-b-0 lg:border-r">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              {view === 'queue' ? `${records.length} sample records` : 'Authoritative state sequence'}
            </p>
            {records.length ? (
              records.map((record) => (
                <RecordRow
                  key={record.id}
                  record={record}
                  selected={selected.id === record.id}
                  onSelect={() => setSelectedId(record.id)}
                />
              ))
            ) : (
              <p className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center text-sm text-stone-500">
                No fictional records match that filter.
              </p>
            )}
          </div>

          <aside className="p-5" aria-live="polite">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
              {KIND_LABELS[selected.kind]}
            </p>
            <h2 className="mt-2 font-display text-2xl font-semibold text-stone-950">{selected.title}</h2>
            <p className="mt-2 text-sm text-stone-600">{selected.summary}</p>
            <dl className="mt-6 space-y-4">
              {selected.details.map((detail) => (
                <div key={detail.label} className="border-b border-stone-100 pb-3">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-stone-500">{detail.label}</dt>
                  <dd className="mt-1 text-sm font-medium text-stone-900">{detail.value}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-6 space-y-3">
              <div>
                <button type="button" className="btn-primary w-full justify-center" disabled>
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  Retry operation
                </button>
                <p className="mt-1 text-center text-xs text-stone-500">Sign in to perform this action</p>
              </div>
              <div>
                <button type="button" className="btn-secondary w-full justify-center" disabled>
                  Resolve selected record
                </button>
                <p className="mt-1 text-center text-xs text-stone-500">Sign in to perform this action</p>
              </div>
              <div>
                <button type="button" className="btn-secondary w-full justify-center" disabled>
                  Open live audit detail
                </button>
                <p className="mt-1 text-center text-xs text-stone-500">Sign in to perform this action</p>
              </div>
            </div>

            <Link to="/admin/login" className="mt-6 inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:text-emerald-800">
              Continue to private staff sign-in
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </aside>
        </div>
      </section>
    </div>
  );
}

export default PublicOperationsTourPage;
