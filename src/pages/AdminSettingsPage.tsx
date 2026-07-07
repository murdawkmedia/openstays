import { Link } from 'react-router-dom';
import { useQuery } from 'convex/react';
import { ExternalLink, Settings } from 'lucide-react';

import { api } from '../../convex/_generated/api';
import { SUPPORTED_CURRENCIES, taxLabelOrDefault } from '../../shared/currency';
import { Spinner } from '../components/Spinner';

/**
 * Settings & configuration (read-only in M0 — editing arrives with staff
 * auth in M1). Values live per-property in the database; today they're set
 * via the seed script or the Convex dashboard (see docs/configuration.md).
 */
export function AdminSettingsPage() {
  const properties = useQuery(api.properties.configList);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-stone-900">
          <Settings className="h-6 w-6 text-emerald-700" aria-hidden="true" />
          Settings
        </h1>
        <Link to="/admin" className="text-sm text-stone-500 hover:text-stone-800">
          ← Booking tape
        </Link>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Read-only for now — editing these values in-app arrives with staff sign-in (M1). Today they
        are configured per property via the seed script or the Convex dashboard.
      </div>

      {properties === undefined ? (
        <Spinner label="Loading configuration…" />
      ) : properties.length === 0 ? (
        <div className="card p-8 text-center text-stone-600">
          No properties configured yet. Run <code className="rounded bg-stone-100 px-1">npm run seed</code>{' '}
          or add one via the Convex dashboard.
        </div>
      ) : (
        properties.map((property) => (
          <section key={property.propertyId} className="card p-6">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-stone-900">{property.name}</h2>
              <span className={`badge ${property.active ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-100 text-stone-600'}`}>
                {property.active ? 'Active' : 'Inactive'}
              </span>
            </div>
            <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              <ConfigRow label="Currency" value={`${property.currency} (supported: ${SUPPORTED_CURRENCIES.join(', ')})`} />
              <ConfigRow
                label="Tax"
                value={`${taxLabelOrDefault(property.taxLabel)} · ${(property.taxRateBps / 100).toFixed(2)}%${property.gstNumber ? ` · #${property.gstNumber}` : ''}`}
              />
              <ConfigRow label="Timezone" value={property.timezone} />
              <ConfigRow label="Check-in / check-out" value={`${property.checkInTime} / ${property.checkOutTime}`} />
              <ConfigRow label="Email" value={property.email} />
              <ConfigRow label="Phone" value={property.phone} />
              <ConfigRow label="Address" value={property.address} />
              <ConfigRow label="Public page" value={`/p/${property.slug}`} />
            </dl>
          </section>
        ))
      )}

      <section className="card p-6">
        <h2 className="font-display text-lg font-semibold text-stone-900">About OpenStays</h2>
        <p className="mt-2 text-sm text-stone-600">
          OpenStays is an open-source booking engine and PMS built by{' '}
          <a
            href="https://www.sebahub.com"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-emerald-700 underline hover:text-emerald-800"
          >
            SebaHub
          </a>{' '}
          in Seba Beach, Alberta, Canada — and dogfooded in production on SebaHub's own lodge,
          cabins, geodomes, yurts, and RV park.
        </p>
        <p className="mt-3 flex flex-wrap gap-4 text-sm">
          <a href="https://www.sebahub.com" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-700 underline hover:text-emerald-800">
            www.sebahub.com <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
          <a href="https://github.com/murdawkmedia/openstays" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-stone-600 underline hover:text-stone-900">
            GitHub <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
          <a href="https://murdawkmedia.github.io/openstays/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-stone-600 underline hover:text-stone-900">
            Docs <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </p>
      </section>
    </div>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs uppercase tracking-wide text-stone-400">{label}</dt>
      <dd className="text-stone-800">{value}</dd>
    </div>
  );
}
