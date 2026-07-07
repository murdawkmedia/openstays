import { ExternalLink, Github, Mountain } from 'lucide-react';

/** Public about page: what OpenStays is and who builds it. */
export function AboutPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="card p-8">
        <div className="mb-4 flex items-center gap-2">
          <Mountain className="h-8 w-8 text-emerald-700" strokeWidth={2} />
          <h1 className="font-display text-3xl font-semibold text-stone-900">About OpenStays</h1>
        </div>
        <p className="text-stone-600">
          OpenStays is an open-source booking engine and property-management system for independent
          lodging — campgrounds, cabins, glamping, yurts, and small resorts. Guests book in a couple
          of clicks; operators keep their data in their own deployment; and reservations are
          double-booking-proof by construction.
        </p>

        <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-5">
          <h2 className="font-display text-lg font-semibold text-emerald-900">Built by SebaHub</h2>
          <p className="mt-1.5 text-sm text-emerald-900/80">
            OpenStays is built and battle-tested in production by{' '}
            <a
              href="https://www.sebahub.com"
              target="_blank"
              rel="noreferrer"
              className="font-semibold underline hover:text-emerald-950"
            >
              SebaHub
            </a>
            , a lakeside community hub in Seba Beach, Alberta, Canada — running its own lodge,
            cabins, geodomes, yurts, and RV park on the same code you're looking at.
          </p>
          <a
            href="https://www.sebahub.com"
            target="_blank"
            rel="noreferrer"
            className="btn-primary mt-4 inline-flex items-center gap-1.5"
          >
            Visit sebahub.com <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>

        <div className="mt-6 space-y-2 text-sm text-stone-600">
          <p className="flex items-center gap-2">
            <Github className="h-4 w-4" aria-hidden="true" />
            <a
              href="https://github.com/murdawkmedia/openstays"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-stone-900"
            >
              Source on GitHub
            </a>{' '}
            — MIT licensed, contributions welcome.
          </p>
          <p className="flex items-center gap-2">
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            <a
              href="https://murdawkmedia.github.io/openstays/"
              target="_blank"
              rel="noreferrer"
              className="underline hover:text-stone-900"
            >
              Documentation
            </a>{' '}
            — quickstart, configuration, self-hosting.
          </p>
        </div>
      </div>
    </div>
  );
}
