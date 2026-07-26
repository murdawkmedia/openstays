import { Link } from 'react-router-dom';

const stages = [
  ['Availability agreed', 'A serializable booking transaction reserves the nights without double-booking.'],
  ['Payment observed', 'The booking ledger trusts authoritative reconciliation, not a browser redirect.'],
  ['Consensus receipt', 'A canonical privacy-safe commitment excludes guest identity and stay details.'],
  ['Bitcoin proof', 'OpenTimestamps distinguishes submission, pending Bitcoin confirmation, and Bitcoin anchored.'],
  ['Guest reward', 'The locally tested Wavelength flow returns 1,000 signet test sats to a self-custodial wallet.'],
] as const;

export function PublicShowcasePage() {
  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-3xl bg-stone-950 px-6 py-10 text-white sm:px-10">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-amber-400">
          Bitcoin++ Toronto · Public showcase
        </p>
        <h1 className="mt-3 font-display text-4xl font-semibold">Consensus Commons</h1>
        <p className="mt-4 max-w-2xl leading-7 text-stone-300">
          OpenStays gives the guest, property, payment rail, notifications, and
          booking channels one authoritative reservation state.
        </p>
        <p className="mt-4 text-sm text-stone-400">
          All inventory and examples are fictional. No production guest data or real funds are used.
        </p>
        <Link to="/p/consensus-commons" className="btn-primary mt-6 inline-flex">
          Explore the booking flow
        </Link>
      </section>

      <section aria-labelledby="consensus-stages">
        <h2 id="consensus-stages" className="text-2xl font-semibold">How consensus is reached</h2>
        <ol className="mt-4 grid gap-4 sm:grid-cols-2">
          {stages.map(([title, body], index) => (
            <li key={title} className="card p-5">
              <p className="text-xs font-semibold text-emerald-700">0{index + 1}</p>
              <h3 className="mt-2 font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-stone-600">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="card p-6">
        <h2 className="text-xl font-semibold">Experimental rails, honest boundaries</h2>
        <p className="mt-3 text-sm leading-6 text-stone-600">
          Wavelength is signet-only and the public showcase does not operate a wallet faucet.
          OpenTimestamps public calendars ultimately anchor into Bitcoin mainnet. Channex is
          adapter ready, not connected.
        </p>
      </section>
    </div>
  );
}
