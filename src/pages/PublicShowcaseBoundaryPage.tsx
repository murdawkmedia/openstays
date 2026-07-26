import { Link } from 'react-router-dom';

export function PublicShowcaseBoundaryPage() {
  return (
    <div className="card mx-auto max-w-xl p-8 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
        Public showcase boundary
      </p>
      <h1 className="mt-3 text-2xl font-semibold">This live operation stays local</h1>
      <p className="mt-3 text-sm leading-6 text-stone-600">
        The wallet, staff console, bridges, and signet rewards were tested locally.
        This public site demonstrates their verified states without exposing operator
        credentials, wallet funds, or a public faucet.
      </p>
      <Link to="/" className="btn-primary mt-6 inline-flex">Return to the showcase</Link>
    </div>
  );
}
