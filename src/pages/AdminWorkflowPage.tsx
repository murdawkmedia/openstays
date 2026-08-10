import { LockKeyhole } from 'lucide-react';
import { useAdminProperty } from '../components/AdminShell';

const COPY: Record<string, { title: string; description: string }> = {
  'front-desk': { title: 'Front desk', description: 'Arrivals, departures, staying-over guests, check-in, no-show, and checkout queues.' },
  housekeeping: { title: 'Housekeeping', description: 'Ready, dirty, cleaning, inspection, do-not-disturb, and assignment workflows.' },
  maintenance: { title: 'Maintenance', description: 'Repair tasks, out-of-service tracking, and explicit inventory blocks.' },
  folios: { title: 'Folios & retail', description: 'Booking folios, standalone sales, immutable charges, payments, and reversals.' },
  quotes: { title: 'Quotes & waitlist', description: 'Non-blocking quotes, follow-up tasks, waitlist entries, and conversion.' },
  contracts: { title: 'Contracts & groups', description: 'Seasonal stays, group blocks, agreements, reminders, and renewals.' },
  'night-audit': { title: 'Night audit', description: 'Daily reconciliation, closeout snapshots, and exception review.' },
  reports: { title: 'Reports', description: 'Operational exports and accounting-ready summaries.' },
};

export function AdminWorkflowPage({ workflow }: { workflow: keyof typeof COPY }) {
  const { property } = useAdminProperty();
  const copy = COPY[workflow];
  return (
    <div className="space-y-6">
      <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">{property.name}</p><h1 className="mt-1 text-2xl font-semibold text-stone-950">{copy.title}</h1><p className="mt-2 max-w-2xl text-sm text-stone-600">{copy.description}</p></div>
      <div className="card max-w-2xl p-6"><div className="flex gap-3"><LockKeyhole className="h-5 w-5 shrink-0 text-amber-600" /><div><h2 className="font-semibold text-stone-900">Workflow staged behind a property flag</h2><p className="mt-1 text-sm text-stone-600">The route and authorization boundary are installed. Write controls appear only after this workflow’s permissions, audit, conflict, and reversal tests pass.</p></div></div></div>
    </div>
  );
}
