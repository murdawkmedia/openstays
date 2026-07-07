import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="card p-8 text-center">
      <h1 className="text-2xl font-semibold text-stone-900">Page not found</h1>
      <p className="mt-2 text-stone-500">We couldn't find what you were looking for.</p>
      <Link to="/" className="btn-primary mt-6 inline-flex">
        Back to home
      </Link>
    </div>
  );
}
