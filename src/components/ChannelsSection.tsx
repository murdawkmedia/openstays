import { useState } from 'react';
import { useMutation, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Radio,
  RefreshCw,
} from 'lucide-react';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { Spinner } from './Spinner';
import { ErrorMessage, extractErrorMessage } from './ErrorMessage';

type ChannelConfig = FunctionReturnType<typeof api.channel.admin.getChannelConfig>;
type ChannelProperty = ChannelConfig['properties'][number];

/**
 * "Channels" settings section — connects a property to Channex (OTA
 * distribution), maps unit types / rate plans, toggles sync, and surfaces
 * status + recent log. Owner-gated visibility, same as the Staff section.
 * v1 scope note (CLAUDE.md): direct bookings + iCal remain the baseline;
 * Channex is dormant until an operator sets CHANNEX_API_KEY and connects.
 */
export function ChannelsSection() {
  const config = useQuery(api.channel.admin.getChannelConfig, {});

  return (
    <section className="card p-6">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-stone-900">
        <Radio className="h-5 w-5 text-emerald-700" aria-hidden="true" />
        Channels
      </h2>

      {config === undefined ? (
        <Spinner label="Loading channel config…" />
      ) : !config.configured ? (
        <NotConfiguredNotice baseUrl={config.baseUrl} />
      ) : (
        <div className="mt-4 space-y-6">
          <p className="text-sm text-stone-600">
            Distributes availability and rates to OTAs (Booking.com, Airbnb, Expedia, VRBO) via{' '}
            <a
              href="https://channex.io"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-emerald-700 underline hover:text-emerald-800"
            >
              Channex — adapter ready, not connected
            </a>
            . A property is not actually live on any OTA until an operator finishes channel + rate
            plan setup and turns on the OTA connection inside the Channex dashboard — mapping the
            IDs here only tells OpenStays where to push.
          </p>
          {config.properties.length === 0 ? (
            <p className="text-sm text-stone-500">No properties configured yet.</p>
          ) : (
            config.properties.map((property) => (
              <PropertyChannelPanel key={property.propertyId} property={property} />
            ))
          )}
        </div>
      )}
    </section>
  );
}

function NotConfiguredNotice({ baseUrl }: { baseUrl: string }) {
  return (
    <div className="mt-4 space-y-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
      <p className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          Channel sync isn't set up on this deployment yet. No <code className="rounded bg-amber-100 px-1">CHANNEX_API_KEY</code>{' '}
          has been set, so OTA distribution stays off — no availability, rates, or bookings flow to
          Channex until an operator sets that key (<code className="rounded bg-amber-100 px-1">npx convex env set CHANNEX_API_KEY …</code>
          ) and connects a property below.
        </span>
      </p>
      <p className="text-xs text-amber-800">
        Configured base URL would be <code className="rounded bg-amber-100 px-1">{baseUrl}</code>. Until then, direct
        bookings and per-unit iCal in/out remain the only distribution paths — this section is safe
        to leave alone.
      </p>
      <a
        href="https://murdawkmedia.github.io/openstays/"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 font-medium text-amber-900 underline hover:text-amber-950"
      >
        Docs <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
      </a>
    </div>
  );
}

function formatTs(ts?: number): string {
  if (!ts) return 'never';
  return new Date(ts).toLocaleString();
}

function PropertyChannelPanel({ property }: { property: ChannelProperty }) {
  const setPropertyChannel = useMutation(api.channel.admin.setPropertyChannel);
  const setUnitTypeChannel = useMutation(api.channel.admin.setUnitTypeChannel);
  const setRatePlanChannel = useMutation(api.channel.admin.setRatePlanChannel);
  const syncNow = useMutation(api.channel.admin.syncNow);

  const [channexPropertyId, setChannexPropertyId] = useState(property.channexPropertyId ?? '');
  const [enabled, setEnabled] = useState(property.enabled);
  const [savingConnection, setSavingConnection] = useState(false);
  const [connectionSaved, setConnectionSaved] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);

  const [logOpen, setLogOpen] = useState(false);

  async function handleSaveConnection() {
    setConnectionError(null);
    setConnectionSaved(false);
    setSavingConnection(true);
    try {
      await setPropertyChannel({
        propertyId: property.propertyId,
        channexPropertyId: channexPropertyId.trim() === '' ? undefined : channexPropertyId.trim(),
        enabled,
      });
      setConnectionSaved(true);
    } catch (err) {
      setConnectionError(extractErrorMessage(err));
    } finally {
      setSavingConnection(false);
    }
  }

  async function handleUnitTypeSave(unitTypeId: Id<'unitTypes'>, value: string) {
    await setUnitTypeChannel({
      unitTypeId,
      channexRoomTypeId: value.trim() === '' ? undefined : value.trim(),
    });
  }

  async function handleRatePlanSave(ratePlanId: Id<'ratePlans'>, value: string) {
    await setRatePlanChannel({
      ratePlanId,
      channexRatePlanId: value.trim() === '' ? undefined : value.trim(),
    });
  }

  async function handleSyncNow() {
    setSyncError(null);
    setSyncMessage(null);
    setSyncing(true);
    try {
      const result = await syncNow({ propertyId: property.propertyId });
      setSyncMessage(result.scheduled ? 'ARI push scheduled.' : 'Nothing scheduled.');
    } catch (err) {
      setSyncError(extractErrorMessage(err));
    } finally {
      setSyncing(false);
    }
  }

  const connected = Boolean(property.channexPropertyId);

  return (
    <div className="rounded-xl border border-stone-200 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-base font-semibold text-stone-900">{property.name}</h3>
        <span
          className={`badge ${connected && property.enabled ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-100 text-stone-600'}`}
        >
          {connected ? (property.enabled ? 'Sync enabled' : 'Connected, sync paused') : 'Not connected'}
        </span>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto]">
        <div>
          <label className="field-label" htmlFor={`channex-property-${property.propertyId}`}>
            Channex Property UUID
          </label>
          <input
            id={`channex-property-${property.propertyId}`}
            className="field-input"
            type="text"
            placeholder="00000000-0000-0000-0000-000000000000"
            value={channexPropertyId}
            onChange={(e) => {
              setChannexPropertyId(e.target.value);
              setConnectionSaved(false);
            }}
          />
        </div>
        <div className="flex items-end gap-2 pb-0.5">
          <label className="flex items-center gap-2 text-sm text-stone-700" htmlFor={`channex-enabled-${property.propertyId}`}>
            <input
              id={`channex-enabled-${property.propertyId}`}
              type="checkbox"
              className="h-4 w-4 rounded border-stone-300 text-emerald-700 focus:ring-emerald-600"
              checked={enabled}
              onChange={(e) => {
                setEnabled(e.target.checked);
                setConnectionSaved(false);
              }}
            />
            Enabled
          </label>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          className="btn-secondary"
          disabled={savingConnection}
          onClick={() => void handleSaveConnection()}
        >
          {savingConnection ? 'Saving…' : 'Save connection'}
        </button>
        {connectionSaved ? (
          <span className="flex items-center gap-1.5 text-sm text-emerald-700">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Saved
          </span>
        ) : null}
      </div>
      {connectionError ? (
        <div className="mt-3">
          <ErrorMessage message={connectionError} />
        </div>
      ) : null}

      {connected ? (
        <>
          <div className="mt-5">
            <h4 className="text-sm font-semibold text-stone-800">Unit types</h4>
            {property.unitTypes.length === 0 ? (
              <p className="mt-1 text-sm text-stone-500">No unit types yet.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-400">
                      <th className="py-2 pr-4">Unit type</th>
                      <th className="py-2 pr-4">Channex Room Type UUID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {property.unitTypes.map((ut) => (
                      <MappingRow
                        key={ut.unitTypeId}
                        label={ut.name}
                        initialValue={ut.channexRoomTypeId ?? ''}
                        onSave={(value) => handleUnitTypeSave(ut.unitTypeId, value)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="mt-5">
            <h4 className="text-sm font-semibold text-stone-800">Rate plans</h4>
            {property.ratePlans.length === 0 ? (
              <p className="mt-1 text-sm text-stone-500">No rate plans yet.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-400">
                      <th className="py-2 pr-4">Rate plan</th>
                      <th className="py-2 pr-4">Channex Rate Plan UUID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {property.ratePlans.map((rp) => (
                      <MappingRow
                        key={rp.ratePlanId}
                        label={rp.name}
                        initialValue={rp.channexRatePlanId ?? ''}
                        onSave={(value) => handleRatePlanSave(rp.ratePlanId, value)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="mt-5 rounded-lg bg-stone-50 px-4 py-3 text-sm text-stone-600">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <div>Last ARI push: {formatTs(property.lastAriPushAt)}</div>
                <div>Last booking poll: {formatTs(property.lastBookingPollAt)}</div>
                <div>
                  Dirty since:{' '}
                  {property.dirtySince ? formatTs(property.dirtySince) : 'up to date'}
                </div>
                {property.lastError ? (
                  <div className="flex items-start gap-1.5 text-red-700">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>Last error: {property.lastError}</span>
                  </div>
                ) : null}
              </div>
              <button
                type="button"
                className="btn-secondary"
                disabled={syncing || !property.enabled}
                title={!property.enabled ? 'Enable sync to push ARI' : undefined}
                onClick={() => void handleSyncNow()}
              >
                <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} aria-hidden="true" />
                {syncing ? 'Syncing…' : 'Sync now'}
              </button>
            </div>
            {syncMessage ? <p className="mt-2 text-emerald-700">{syncMessage}</p> : null}
            {syncError ? (
              <div className="mt-2">
                <ErrorMessage message={syncError} />
              </div>
            ) : null}
          </div>

          <div className="mt-4">
            <button
              type="button"
              className="flex items-center gap-1.5 text-sm font-medium text-stone-600 hover:text-stone-900"
              onClick={() => setLogOpen((v) => !v)}
            >
              {logOpen ? (
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              )}
              Recent sync log
            </button>
            {logOpen ? <RecentSyncLog propertyId={property.propertyId} /> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function MappingRow({
  label,
  initialValue,
  onSave,
}: {
  label: string;
  initialValue: string;
  onSave: (value: string) => Promise<void>;
}) {
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleBlurSave() {
    if (value === initialValue) return;
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      await onSave(value);
      setSaved(true);
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="border-b border-stone-100 last:border-0 align-top">
      <td className="py-2 pr-4 text-stone-800">{label}</td>
      <td className="py-2 pr-4">
        <input
          className="field-input"
          type="text"
          placeholder="00000000-0000-0000-0000-000000000000"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          onBlur={() => void handleBlurSave()}
        />
        <div className="mt-1 flex items-center gap-2 text-xs">
          {saving ? <span className="text-stone-400">Saving…</span> : null}
          {saved && !saving ? (
            <span className="flex items-center gap-1 text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              Saved
            </span>
          ) : null}
          {error ? <span className="text-red-700">{error}</span> : null}
        </div>
      </td>
    </tr>
  );
}

function RecentSyncLog({ propertyId }: { propertyId: Id<'properties'> }) {
  const log = useQuery(api.channel.admin.recentSyncLog, { propertyId, limit: 20 });

  if (log === undefined) return <Spinner label="Loading log…" />;
  if (log.length === 0) {
    return <p className="mt-2 text-sm text-stone-500">No sync activity yet.</p>;
  }

  return (
    <ul className="mt-2 space-y-1.5 text-sm">
      {log.map((entry, i) => (
        <li key={i} className="flex items-start gap-2">
          <span className={entry.ok ? 'text-emerald-700' : 'text-red-700'}>{entry.ok ? '✓' : '✗'}</span>
          <span className="text-stone-500">{new Date(entry.ts).toLocaleString()}</span>
          <span className="font-medium text-stone-700">{entry.kind}</span>
          <span className="text-stone-600">{entry.detail}</span>
        </li>
      ))}
    </ul>
  );
}
