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
      <div className="mb-8 rounded-2xl bg-stone-950 px-6 py-8 text-white">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-400">Bitcoin++ Toronto · Hackathon MVP</p>
        <h1 className="mt-2 text-3xl font-semibold">Consensus Commons</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-stone-300">Different participants and payment rails reach one authoritative booking state—without double-booking, forged payment confirmation, or silent refund failures.</p>
        <p className="mt-4 text-xs text-stone-400">All demo inventory is fictional. Zaprite sandbox and Wavelength signet are experimental, separate rails.</p>
      </div>
      <h2 className="mb-6 text-2xl font-semibold text-stone-900">Choose a place to stay</h2>
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
