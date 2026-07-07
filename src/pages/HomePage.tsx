import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from 'convex/react';
import { MapPin } from 'lucide-react';

import { api } from '../../convex/_generated/api';
import { Spinner } from '../components/Spinner';

/** Lists active properties. If there's exactly one, redirect straight to it. */
export function HomePage() {
  const properties = useQuery(api.properties.listActive, {});
  const navigate = useNavigate();

  useEffect(() => {
    if (properties && properties.length === 1) {
      navigate(`/p/${properties[0].slug}`, { replace: true });
    }
  }, [properties, navigate]);

  if (properties === undefined) return <Spinner label="Loading stays…" />;

  if (properties.length === 0) {
    return (
      <div className="card p-8 text-center text-stone-600">
        <p>No properties are open for booking yet.</p>
      </div>
    );
  }

  if (properties.length === 1) {
    // Redirect effect above will fire; avoid flashing the list.
    return <Spinner label="Loading stays…" />;
  }

  return (
    <div>
      <h1 className="mb-6 text-3xl font-semibold text-stone-900">Choose a place to stay</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {properties.map((property) => (
          <Link
            key={property.propertyId}
            to={`/p/${property.slug}`}
            className="card p-6 transition hover:border-emerald-300 hover:shadow-md"
          >
            <h2 className="text-xl font-semibold text-stone-900">{property.name}</h2>
            <p className="mt-2 flex items-center gap-1.5 text-sm text-stone-500">
              <MapPin className="h-4 w-4" aria-hidden="true" />
              {property.address}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}
