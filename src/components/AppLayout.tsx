import { Link, Outlet } from 'react-router-dom';
import { Mountain } from 'lucide-react';
import { PUBLIC_SHOWCASE } from '../lib/publicShowcase';

/** Shared chrome (header/footer) for every route, rendered via <Outlet />. */
export function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      {PUBLIC_SHOWCASE.enabled ? (
        <div className="bg-amber-100 px-4 py-2 text-center text-xs font-semibold text-amber-950">
          Public showcase · fictional data · signet test sats
        </div>
      ) : null}
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Link to="/" className="flex items-center gap-2 text-stone-900">
            <Mountain className="h-6 w-6 text-emerald-700" strokeWidth={2} />
            <span className="font-display text-lg font-semibold">OpenStays</span>
            <span className="hidden rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-800 sm:inline">Consensus Commons</span>
          </Link>
          {PUBLIC_SHOWCASE.allowStaffRoutes ? (
            <nav className="text-sm text-stone-500">
              <Link to="/admin" className="hover:text-stone-800">
                Staff
              </Link>
            </nav>
          ) : (
            <Link to="/" className="text-sm font-medium text-emerald-700 hover:text-emerald-800">
              How it works
            </Link>
          )}
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-stone-200 py-6 text-center text-xs text-stone-400">
        <p>
          Powered by <span className="font-semibold text-stone-500">OpenStays</span> — an open-source
          booking engine built by{' '}
          <a
            href="https://www.sebahub.com"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-emerald-700 hover:text-emerald-800"
          >
            SebaHub
          </a>
        </p>
        <p className="mt-1.5 space-x-3">
          <Link to="/about" className="hover:text-stone-600">
            About
          </Link>
          <a
            href="https://github.com/murdawkmedia/openstays"
            target="_blank"
            rel="noreferrer"
            className="hover:text-stone-600"
          >
            GitHub
          </a>
          <a
            href="https://murdawkmedia.github.io/openstays/"
            target="_blank"
            rel="noreferrer"
            className="hover:text-stone-600"
          >
            Docs
          </a>
        </p>
      </footer>
    </div>
  );
}
