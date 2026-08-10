import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import { api } from '../../convex/_generated/api';
import { useAdminProperty } from '../components/AdminShell';
import { Spinner } from '../components/Spinner';
import { todayIso } from '../lib/dates';

export function AdminNightAuditPage() {
  const { property, enabledFeatures } = useAdminProperty(); const enabled = enabledFeatures.includes('night_audit');
  const [businessDate, setBusinessDate] = useState(todayIso()); const [message, setMessage] = useState<string | null>(null);
  const preview = useQuery(api.closeout.preview, enabled ? { propertyId: property.propertyId, businessDate } : 'skip') as Record<string, number | string> | undefined;
  const closeNight = useMutation(api.closeout.closeNight);
  if (!enabled) return <div className="card max-w-2xl p-6"><h1 className="text-2xl font-semibold">Night audit</h1><p className="mt-2 text-sm text-stone-600">Installed and protected by the <code>night_audit</code> property flag.</p></div>;
  return <div className="space-y-5"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Oversight</p><h1 className="mt-1 text-2xl font-semibold">Night audit</h1></div><div className="card flex flex-wrap items-end justify-between gap-3 p-4"><label><span className="field-label">Business date</span><input className="field-input" type="date" value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} /></label><button type="button" className="btn-primary" onClick={() => void closeNight({ propertyId: property.propertyId, businessDate, requestId: crypto.randomUUID() }).then(() => setMessage(`${businessDate} closed.`)).catch((error) => setMessage(error instanceof Error ? error.message : 'Close failed.'))}>Close business date</button></div>{message ? <p className="rounded-lg bg-stone-900 px-4 py-3 text-sm text-white" role="status">{message}</p> : null}{preview === undefined ? <Spinner label="Calculating closeout…" /> : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[['Posted revenue', preview.postedRevenueCents, true], ['Payments', preview.paymentsCents, true], ['Open folios', preview.openFolios], ['Occupied units', preview.occupiedUnits], ['Open refund cases', preview.openRefundCases], ['Channel conflicts', preview.channelConflicts]].map(([label, value, money]) => <div key={String(label)} className="card p-5"><p className="text-sm text-stone-500">{label}</p><p className="mt-2 text-2xl font-semibold">{money ? `$${(Number(value) / 100).toFixed(2)}` : value}</p></div>)}</div>}</div>;
}
