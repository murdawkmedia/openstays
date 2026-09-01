import { Link, Outlet } from 'react-router-dom';
import { Mountain } from 'lucide-react';

/** Production chrome contains no public-showcase or experimental-rail copy. */
export function ProductionAppLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main-content" className="skip-link">Skip to main content</a>
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Link to="/" className="flex items-center gap-2 text-stone-900">
            <Mountain className="h-6 w-6 text-emerald-700" strokeWidth={2} aria-hidden="true" />
            <span className="font-display text-lg font-semibold">OpenStays</span>
          </Link>
          <nav aria-label="Primary" className="flex items-center gap-3 text-sm">
            <Link to="/admin" className="text-xs text-stone-500 hover:text-stone-800">Staff</Link>
          </nav>
        </div>
      </header>
      <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-stone-200 py-6 text-center text-xs text-stone-400">
        <p>
          Powered by <span className="font-semibold text-stone-500">OpenStays</span> — open-source
          property management by{' '}
          <a href="https://www.sebahub.com" target="_blank" rel="noreferrer" className="font-semibold text-emerald-700 hover:text-emerald-800">
            SebaHub
          </a>
        </p>
        <p className="mt-1.5 space-x-3">
          <Link to="/about" className="hover:text-stone-600">About</Link>
          <a href="https://github.com/murdawkmedia/openstays" target="_blank" rel="noreferrer" className="hover:text-stone-600">Open-source project</a>
        </p>
      </footer>
    </div>
  );
}
