import { Link, useParams } from 'react-router-dom';
import { useQuery } from 'convex/react';
import { MapPin, Users } from 'lucide-react';

import { api } from '../../convex/_generated/api';
import { Spinner } from '../components/Spinner';
import { NotFoundPage } from './NotFoundPage';

const KIND_LABELS: Record<string, string> = {
  room: 'Room',
  cabin: 'Cabin',
  site: 'RV / Campsite',
  rv_rental: 'RV Rental',
  yurt: 'Yurt',
  geodome: 'Geodome',
};

export function PropertyPage() {
  const { propertySlug } = useParams<{ propertySlug: string }>();
  const property = useQuery(api.properties.bySlug, propertySlug ? { slug: propertySlug } : 'skip');

  if (!propertySlug) return <NotFoundPage />;
  if (property === undefined) return <Spinner label="Loading property…" />;
  if (property === null) return <NotFoundPage />;

  return (
    <div>
      <div className="card mb-8 p-8">
        <h1 className="text-3xl font-semibold text-stone-900">{property.name}</h1>
        <p className="mt-2 flex items-center gap-1.5 text-stone-500">
          <MapPin className="h-4 w-4" aria-hidden="true" />
          {property.address}
        </p>
        <p className="mt-1 text-sm text-stone-400">
          Check-in {property.checkInTime} · Check-out {property.checkOutTime}
        </p>
      </div>

      <h2 className="mb-4 text-xl font-semibold text-stone-900">Places to stay</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {property.unitTypes.map((unitType) => (
          <Link
            key={unitType.unitTypeId}
            to={
              unitType.comingSoon
                ? '#'
                : `/p/${property.slug}/stay/${unitType.slug}`
            }
            aria-disabled={unitType.comingSoon}
            className={`card flex flex-col p-6 transition ${
              unitType.comingSoon
                ? 'cursor-not-allowed opacity-60'
                : 'hover:border-emerald-300 hover:shadow-md'
            }`}
            onClick={(e) => {
              if (unitType.comingSoon) e.preventDefault();
            }}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="badge bg-emerald-100 text-emerald-800">
                {KIND_LABELS[unitType.kind] ?? unitType.kind}
              </span>
              {unitType.comingSoon ? <span className="badge">Coming soon</span> : null}
            </div>
            <h3 className="text-lg font-semibold text-stone-900">{unitType.name}</h3>
            <p className="mt-1.5 line-clamp-3 text-sm text-stone-600">{unitType.description}</p>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-stone-500">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              Sleeps up to {unitType.maxOccupancy}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
