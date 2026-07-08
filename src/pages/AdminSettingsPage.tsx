import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useMutation, useQuery } from 'convex/react';
import { useAuthActions } from '@convex-dev/auth/react';
import { CheckCircle2, ExternalLink, ShieldAlert, ShieldCheck, Settings, UserPlus, Users } from 'lucide-react';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { SUPPORTED_CURRENCIES, taxLabelOrDefault } from '../../shared/currency';
import { Spinner } from '../components/Spinner';
import { ErrorMessage, extractErrorMessage } from '../components/ErrorMessage';
import { useStaffGate } from '../lib/useStaff';

type PropertyConfig = {
  propertyId: Id<'properties'>;
  name: string;
  slug: string;
  active: boolean;
  timezone: string;
  currency: string;
  taxRateBps: number;
  taxLabel?: string;
  gstNumber?: string;
  email: string;
  phone: string;
  address: string;
  checkInTime: string;
  checkOutTime: string;
};

type PropertyFormState = {
  name: string;
  email: string;
  phone: string;
  address: string;
  currency: string;
  taxRateBps: string;
  taxLabel: string;
  gstNumber: string;
  checkInTime: string;
  checkOutTime: string;
};

function toFormState(property: PropertyConfig): PropertyFormState {
  return {
    name: property.name,
    email: property.email,
    phone: property.phone,
    address: property.address,
    currency: property.currency,
    taxRateBps: String(property.taxRateBps),
    taxLabel: property.taxLabel ?? '',
    gstNumber: property.gstNumber ?? '',
    checkInTime: property.checkInTime,
    checkOutTime: property.checkOutTime,
  };
}

/**
 * Settings & configuration (M1: editable by signed-in staff). The "Staff"
 * management section (grant/revoke/list) is owner-only.
 */
export function AdminSettingsPage() {
  const gate = useStaffGate();
  const { signOut } = useAuthActions();
  const properties = useQuery(api.properties.configList, gate.status === 'staff' ? {} : 'skip');

  if (gate.status === 'loading') return <Spinner label="Checking staff access…" />;
  if (gate.status === 'signed_out') return <Navigate to="/admin/login" replace />;
  if (gate.status === 'awaiting_access') {
    return (
      <div className="mx-auto max-w-md space-y-4 text-center">
        <ShieldAlert className="mx-auto h-8 w-8 text-amber-600" aria-hidden="true" />
        <h1 className="font-display text-xl font-semibold text-stone-900">Awaiting staff access</h1>
        <p className="text-sm text-stone-600">
          You're signed in but no owner has granted you staff access yet. Ask an owner to add you here once
          you can reach it, or contact your administrator.
        </p>
        <button type="button" className="btn-secondary" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold text-stone-900">
          <Settings className="h-6 w-6 text-emerald-700" aria-hidden="true" />
          Settings
        </h1>
        <Link to="/admin" className="text-sm text-stone-500 hover:text-stone-800">
          ← Booking tape
        </Link>
      </div>

      <div className="flex items-center justify-between gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <span className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />
          Signed in as {gate.name} ({gate.role})
        </span>
        <button
          type="button"
          className="text-xs font-medium text-emerald-700 underline hover:text-emerald-900"
          onClick={() => void signOut()}
        >
          Sign out
        </button>
      </div>

      {properties === undefined ? (
        <Spinner label="Loading configuration…" />
      ) : properties.length === 0 ? (
        <div className="card p-8 text-center text-stone-600">
          No properties configured yet. Run <code className="rounded bg-stone-100 px-1">npm run seed</code>{' '}
          or add one via the Convex dashboard.
        </div>
      ) : (
        properties.map((property) => <PropertyEditor key={property.propertyId} property={property} />)
      )}

      {gate.role === 'owner' ? <StaffSection /> : null}

      <section className="card p-6">
        <h2 className="font-display text-lg font-semibold text-stone-900">About OpenStays</h2>
        <p className="mt-2 text-sm text-stone-600">
          OpenStays is an open-source booking engine and PMS built by{' '}
          <a
            href="https://www.sebahub.com"
            target="_blank"
            rel="noreferrer"
            className="font-semibold text-emerald-700 underline hover:text-emerald-800"
          >
            SebaHub
          </a>{' '}
          in Seba Beach, Alberta, Canada — and dogfooded in production on SebaHub's own lodge,
          cabins, geodomes, yurts, and RV park.
        </p>
        <p className="mt-3 flex flex-wrap gap-4 text-sm">
          <a href="https://www.sebahub.com" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-700 underline hover:text-emerald-800">
            www.sebahub.com <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
          <a href="https://github.com/murdawkmedia/openstays" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-stone-600 underline hover:text-stone-900">
            GitHub <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
          <a href="https://murdawkmedia.github.io/openstays/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-stone-600 underline hover:text-stone-900">
            Docs <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </p>
      </section>
    </div>
  );
}

function PropertyEditor({ property }: { property: PropertyConfig }) {
  const updateProperty = useMutation(api.staff.updateProperty);
  const [form, setForm] = useState<PropertyFormState>(() => toFormState(property));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setForm(toFormState(property));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property.propertyId]);

  const set = <K extends keyof PropertyFormState>(key: K, value: PropertyFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  async function handleSave() {
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const taxRateBps = Number(form.taxRateBps);
      await updateProperty({
        propertyId: property.propertyId,
        patch: {
          name: form.name,
          email: form.email,
          phone: form.phone,
          address: form.address,
          currency: form.currency,
          taxRateBps,
          taxLabel: form.taxLabel,
          gstNumber: form.gstNumber,
          checkInTime: form.checkInTime,
          checkOutTime: form.checkOutTime,
        },
      });
      setSaved(true);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-lg font-semibold text-stone-900">{property.name}</h2>
        <span className={`badge ${property.active ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-100 text-stone-600'}`}>
          {property.active ? 'Active' : 'Inactive'}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="field-label" htmlFor={`name-${property.propertyId}`}>
            Name
          </label>
          <input
            id={`name-${property.propertyId}`}
            className="field-input"
            type="text"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor={`currency-${property.propertyId}`}>
            Currency
          </label>
          <select
            id={`currency-${property.propertyId}`}
            className="field-input"
            value={form.currency}
            onChange={(e) => set('currency', e.target.value)}
          >
            {SUPPORTED_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor={`tax-rate-${property.propertyId}`}>
            Tax rate (basis points, 500 = 5%)
          </label>
          <input
            id={`tax-rate-${property.propertyId}`}
            className="field-input"
            type="number"
            min={0}
            max={3000}
            step={1}
            value={form.taxRateBps}
            onChange={(e) => set('taxRateBps', e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor={`tax-label-${property.propertyId}`}>
            Tax label
          </label>
          <input
            id={`tax-label-${property.propertyId}`}
            className="field-input"
            type="text"
            placeholder={taxLabelOrDefault(undefined)}
            value={form.taxLabel}
            onChange={(e) => set('taxLabel', e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor={`gst-number-${property.propertyId}`}>
            Tax registration number
          </label>
          <input
            id={`gst-number-${property.propertyId}`}
            className="field-input"
            type="text"
            value={form.gstNumber}
            onChange={(e) => set('gstNumber', e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor={`timezone-${property.propertyId}`}>
            Timezone
          </label>
          <input id={`timezone-${property.propertyId}`} className="field-input bg-stone-50" type="text" value={property.timezone} disabled />
        </div>
        <div>
          <label className="field-label" htmlFor={`check-in-${property.propertyId}`}>
            Check-in time
          </label>
          <input
            id={`check-in-${property.propertyId}`}
            className="field-input"
            type="time"
            value={form.checkInTime}
            onChange={(e) => set('checkInTime', e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor={`check-out-${property.propertyId}`}>
            Check-out time
          </label>
          <input
            id={`check-out-${property.propertyId}`}
            className="field-input"
            type="time"
            value={form.checkOutTime}
            onChange={(e) => set('checkOutTime', e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor={`email-${property.propertyId}`}>
            Email
          </label>
          <input
            id={`email-${property.propertyId}`}
            className="field-input"
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor={`phone-${property.propertyId}`}>
            Phone
          </label>
          <input
            id={`phone-${property.propertyId}`}
            className="field-input"
            type="tel"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="field-label" htmlFor={`address-${property.propertyId}`}>
            Address
          </label>
          <input
            id={`address-${property.propertyId}`}
            className="field-input"
            type="text"
            value={form.address}
            onChange={(e) => set('address', e.target.value)}
          />
        </div>
        <div className="sm:col-span-2 text-xs text-stone-400">Public page: /p/{property.slug}</div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button type="button" className="btn-primary" disabled={saving} onClick={() => void handleSave()}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        {saved ? (
          <span className="flex items-center gap-1.5 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Saved
          </span>
        ) : null}
      </div>
      {error ? (
        <div className="mt-3">
          <ErrorMessage message={error} />
        </div>
      ) : null}
    </section>
  );
}

function StaffSection() {
  const staffList = useQuery(api.staff.listStaff);
  const grantStaff = useMutation(api.staff.grantStaff);
  const revokeStaff = useMutation(api.staff.revokeStaff);

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'owner' | 'staff'>('staff');
  const [granting, setGranting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<Id<'staffProfiles'> | null>(null);

  async function handleGrant(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setGranting(true);
    try {
      await grantStaff({ email, name, role });
      setEmail('');
      setName('');
      setRole('staff');
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setGranting(false);
    }
  }

  async function handleRevoke(staffProfileId: Id<'staffProfiles'>) {
    setError(null);
    setRevokingId(staffProfileId);
    try {
      await revokeStaff({ staffProfileId });
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <section className="card p-6">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-stone-900">
        <Users className="h-5 w-5 text-emerald-700" aria-hidden="true" />
        Staff
      </h2>

      {staffList === undefined ? (
        <Spinner label="Loading staff…" />
      ) : staffList.length === 0 ? (
        <p className="mt-3 text-sm text-stone-500">No staff profiles yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-400">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4" />
              </tr>
            </thead>
            <tbody>
              {staffList.map((s) => (
                <tr key={s.staffProfileId} className="border-b border-stone-100 last:border-0">
                  <td className="py-2 pr-4 text-stone-800">{s.name}</td>
                  <td className="py-2 pr-4 text-stone-600">{s.email}</td>
                  <td className="py-2 pr-4 text-stone-600">{s.role}</td>
                  <td className="py-2 pr-4">
                    <span className={`badge ${s.active ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-100 text-stone-600'}`}>
                      {s.active ? 'Active' : 'Revoked'}
                    </span>
                  </td>
                  <td className="py-2 pr-4">
                    {s.active ? (
                      <button
                        type="button"
                        className="text-xs font-medium text-red-600 underline hover:text-red-800 disabled:opacity-50"
                        disabled={revokingId === s.staffProfileId}
                        onClick={() => void handleRevoke(s.staffProfileId)}
                      >
                        {revokingId === s.staffProfileId ? 'Revoking…' : 'Revoke'}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form className="mt-6 grid gap-4 sm:grid-cols-3" onSubmit={handleGrant}>
        <div>
          <label className="field-label" htmlFor="grant-email">
            Email
          </label>
          <input
            id="grant-email"
            className="field-input"
            type="email"
            required
            placeholder="staff must sign up first"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="grant-name">
            Name
          </label>
          <input
            id="grant-name"
            className="field-input"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div>
          <label className="field-label" htmlFor="grant-role">
            Role
          </label>
          <select
            id="grant-role"
            className="field-input"
            value={role}
            onChange={(e) => setRole(e.target.value as 'owner' | 'staff')}
          >
            <option value="staff">Staff</option>
            <option value="owner">Owner</option>
          </select>
        </div>
        <div className="sm:col-span-3">
          <button type="submit" className="btn-primary" disabled={granting}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            {granting ? 'Granting…' : 'Grant access'}
          </button>
        </div>
      </form>
      <p className="mt-2 text-xs text-stone-400">
        The person must sign up at /admin/login first — granting looks up their account by email.
      </p>

      {error ? (
        <div className="mt-3">
          <ErrorMessage message={error} />
        </div>
      ) : null}
    </section>
  );
}
