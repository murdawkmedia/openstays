import { Link, Outlet } from 'react-router-dom';
import { Mountain } from 'lucide-react';

/** Shared chrome (header/footer) for every route, rendered via <Outlet />. */
export function AppLayout() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <Link to="/" className="flex items-center gap-2 text-stone-900">
            <Mountain className="h-6 w-6 text-emerald-700" strokeWidth={2} />
            <span className="font-display text-lg font-semibold">OpenStays</span>
          </Link>
          <nav className="text-sm text-stone-500">
            <Link to="/admin" className="hover:text-stone-800">
              Staff
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
        <Outlet />
      </main>
      <footer className="border-t border-stone-200 py-6 text-center text-xs text-stone-400">
        Built with OpenStays — an open-source booking engine.
      </footer>
    </div>
  );
}
