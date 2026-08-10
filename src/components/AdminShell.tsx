import { useEffect, useState } from 'react';
import { useAuthActions } from '@convex-dev/auth/react';
import { useMutation, useQuery } from 'convex/react';
import {
  BedDouble,
  BookOpenCheck,
  CalendarClock,
  ChevronDown,
  ClipboardList,
  FileText,
  Gauge,
  Sparkles,
  MessageSquareText,
  ReceiptText,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  Wrench,
} from 'lucide-react';
import { NavLink, Navigate, Outlet, useOutletContext } from 'react-router-dom';

import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { Spinner } from './Spinner';
import { useStaffGate } from '../lib/useStaff';

interface AssignedProperty {
  propertyId: Id<'properties'>;
  name: string;
  slug: string;
  role: string;
  capabilities: string[];
}

export interface AdminPropertyContext {
  property: AssignedProperty;
  commandCenterEnabled: boolean;
  enabledFeatures: string[];
}

const NAV_GROUPS = [
  {
    label: 'Operations',
    items: [
      { to: '/admin/command', label: 'Command center', icon: Gauge },
      { to: '/admin/front-desk', label: 'Front desk', icon: BedDouble },
      { to: '/admin/housekeeping', label: 'Housekeeping', icon: Sparkles },
      { to: '/admin/maintenance', label: 'Maintenance', icon: Wrench },
      { to: '/admin/operations', label: 'Messages & refunds', icon: MessageSquareText },
    ],
  },
  {
    label: 'Commerce',
    items: [
      { to: '/admin/folios', label: 'Folios & retail', icon: ReceiptText },
      { to: '/admin/quotes', label: 'Quotes & waitlist', icon: ClipboardList },
      { to: '/admin/contracts', label: 'Contracts & groups', icon: FileText },
    ],
  },
  {
    label: 'Oversight',
    items: [
      { to: '/admin/night-audit', label: 'Night audit', icon: CalendarClock },
      { to: '/admin/reports', label: 'Reports', icon: BookOpenCheck },
      { to: '/admin/settings', label: 'Settings', icon: Settings },
    ],
  },
] as const;

export function AdminShell() {
  const gate = useStaffGate();
  const { signOut } = useAuthActions();
  const properties = useQuery(
    api.staff.assignedProperties,
    gate.status === 'staff' ? {} : 'skip',
  ) as AssignedProperty[] | undefined;
  const [propertyId, setPropertyId] = useState<Id<'properties'> | null>(null);
  const [globalSearch, setGlobalSearch] = useState('');
  const [searchRefreshState, setSearchRefreshState] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const rebuildSearch = useMutation((api as any).operationalSearch.rebuild);

  useEffect(() => {
    if (!properties?.length) return;
    if (!propertyId || !properties.some((property) => property.propertyId === propertyId)) {
      setPropertyId(properties[0].propertyId);
    }
  }, [properties, propertyId]);

  const foundation = useQuery(
    (api as any).operationsFoundation.snapshot,
    gate.status === 'staff' && propertyId ? { propertyId } : 'skip',
  ) as {
    features: Array<{ feature: string; enabled: boolean }>;
    operationalStatus: {
      alertCount: number;
      alerts: Array<{ kind: string; label: string }>;
      channel: { state: 'adapter_ready' | 'paused' | 'pending' | 'synchronized' | 'error'; label: string };
    };
  } | undefined;
  const queriedCommandCenterEnabled =
    foundation?.features.some((feature) => feature.feature === 'command_center' && feature.enabled) ?? false;
  const searchResults = useQuery(
    (api as any).operationalSearch.search,
    gate.status === 'staff' && propertyId && queriedCommandCenterEnabled && globalSearch.trim().length >= 2
      ? { propertyId, text: globalSearch, limit: 12 }
      : 'skip',
  ) as Array<{ recordType: string; recordId: string; title: string; subtitle: string; status: string }> | undefined;

  if (gate.status === 'loading') return <Spinner label="Checking staff access…" />;
  if (gate.status === 'signed_out') return <Navigate to="/admin/login" replace />;
  if (gate.status === 'awaiting_access') {
    return (
      <div className="mx-auto max-w-md space-y-4 py-12 text-center">
        <ShieldAlert className="mx-auto h-8 w-8 text-amber-600" aria-hidden="true" />
        <h1 className="text-xl font-semibold text-stone-900">Awaiting staff access</h1>
        <p className="text-sm text-stone-600">
          You are signed in, but an owner has not assigned you to a property yet.
        </p>
        <button type="button" className="btn-secondary" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    );
  }
  if (properties === undefined || (propertyId && foundation === undefined)) {
    return <Spinner label="Loading operations…" />;
  }
  if (properties.length === 0 || !propertyId) {
    return <p className="py-12 text-center text-stone-600">No active property assignment is available.</p>;
  }

  const property = properties.find((candidate) => candidate.propertyId === propertyId) ?? properties[0];
  const commandCenterEnabled = queriedCommandCenterEnabled;
  const enabledFeatures = foundation?.features.filter((feature) => feature.enabled).map((feature) => feature.feature) ?? [];
  const operationalStatus = foundation?.operationalStatus;
  const searchRoute: Record<string, string> = {
    booking: '/admin/command',
    quote: '/admin/quotes',
    waitlist: '/admin/quotes',
    task: '/admin/command',
    maintenance: '/admin/maintenance',
    folio: '/admin/folios',
    group: '/admin/contracts',
    contract: '/admin/contracts',
  };

  async function refreshSearchProjection() {
    setSearchRefreshState('working');
    try {
      await rebuildSearch({
        propertyId: property.propertyId,
        requestId: `search-rebuild:${crypto.randomUUID()}`,
      });
      setSearchRefreshState('done');
    } catch {
      setSearchRefreshState('error');
    }
  }

  return (
    <div className="-mx-4 -my-8 min-h-[calc(100vh-7rem)] bg-stone-100 sm:-mx-6 lg:-mx-8">
      <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0 flex-1">
            <label htmlFor="active-property" className="sr-only">Active property</label>
            <select
              id="active-property"
              className="max-w-xs rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-900"
              value={property.propertyId}
              onChange={(event) => setPropertyId(event.target.value as Id<'properties'>)}
            >
              {properties.map((candidate) => (
                <option key={candidate.propertyId} value={candidate.propertyId}>{candidate.name}</option>
              ))}
            </select>
          </div>
          <div className="relative order-last w-full lg:order-none lg:w-[min(34rem,42vw)]">
            <label htmlFor="staff-global-search" className="sr-only">Search staff records</label>
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-stone-400" aria-hidden="true" />
            <input
              id="staff-global-search"
              className="field-input pl-9"
              value={globalSearch}
              onChange={(event) => setGlobalSearch(event.target.value)}
              placeholder="Search guests, bookings, units, quotes, tasks, folios…"
              autoComplete="off"
            />
            {globalSearch.trim().length >= 2 ? (
              <div className="absolute inset-x-0 top-full z-50 mt-2 max-h-80 overflow-y-auto rounded-xl border border-stone-200 bg-white p-2 shadow-2xl" role="region" aria-label="Staff search results" aria-live="polite">
                {searchResults === undefined ? <p className="px-3 py-4 text-sm text-stone-500">Searching…</p> : null}
                {searchResults?.map((result) => (
                  <NavLink
                    key={`${result.recordType}:${result.recordId}`}
                    to={`${searchRoute[result.recordType] ?? '/admin/command'}?recordType=${encodeURIComponent(result.recordType)}&recordId=${encodeURIComponent(result.recordId)}`}
                    className="block rounded-lg px-3 py-2 hover:bg-stone-50"
                    onClick={() => setGlobalSearch('')}
                  >
                    <span className="flex items-center justify-between gap-3 text-sm font-semibold text-stone-900">
                      <span className="truncate">{result.title}</span>
                      <span className="shrink-0 text-[10px] uppercase tracking-wide text-stone-500">{result.recordType}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-stone-500">{result.subtitle} · {result.status.replaceAll('_', ' ')}</span>
                  </NavLink>
                ))}
                {searchResults?.length === 0 ? <p className="px-3 py-4 text-sm text-stone-500">No matching staff records.</p> : null}
                {property.capabilities.includes('property.configure') ? (
                  <button
                    type="button"
                    className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-stone-100 px-3 py-2 text-left text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                    onClick={() => void refreshSearchProjection()}
                    disabled={searchRefreshState === 'working'}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${searchRefreshState === 'working' ? 'animate-spin' : ''}`} aria-hidden="true" />
                    {searchRefreshState === 'working' ? 'Refreshing private search index…' : searchRefreshState === 'done' ? 'Search index refreshed' : searchRefreshState === 'error' ? 'Refresh failed — try again' : 'Refresh private search index'}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          {operationalStatus?.alertCount ? (
            <details className="relative">
              <summary className="cursor-pointer list-none rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
                {operationalStatus.alertCount} alert{operationalStatus.alertCount === 1 ? '' : 's'}
              </summary>
              <div className="absolute right-0 mt-2 w-64 space-y-2 rounded-xl border border-stone-200 bg-white p-3 text-xs text-stone-700 shadow-xl">
                {operationalStatus.alerts.map((alert) => (
                  <p key={`${alert.kind}:${alert.label}`} className="rounded-lg bg-amber-50 px-3 py-2">{alert.label}</p>
                ))}
              </div>
            </details>
          ) : null}
          {operationalStatus ? (
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${operationalStatus.channel.state === 'error' ? 'bg-red-100 text-red-800' : operationalStatus.channel.state === 'pending' ? 'bg-amber-100 text-amber-900' : 'bg-emerald-50 text-emerald-800'}`}>
              {operationalStatus.channel.label}
            </span>
          ) : null}
          <details className="relative">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm font-medium text-stone-800 hover:bg-stone-50">
              <span className="max-w-36 truncate">{gate.name}</span>
              <span className="hidden text-xs font-normal text-stone-500 sm:inline">{property.role.replace('_', ' ')}</span>
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </summary>
            <div className="absolute right-0 mt-2 w-56 rounded-xl border border-stone-200 bg-white p-2 shadow-xl">
              <NavLink className="block rounded-lg px-3 py-2 text-sm hover:bg-stone-50" to="/admin/settings">
                Profile & security
              </NavLink>
              <button
                type="button"
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50"
                onClick={() => void signOut()}
              >
                Sign out
              </button>
            </div>
          </details>
        </div>
      </header>

      <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="border-b border-stone-200 bg-stone-950 text-stone-200 lg:min-h-[calc(100vh-7rem)] lg:border-b-0 lg:border-r">
          <nav aria-label="Staff operations" className="flex gap-2 overflow-x-auto p-3 lg:block lg:space-y-5 lg:p-4">
            {NAV_GROUPS.map((group) => (
              <div key={group.label} className="shrink-0 lg:space-y-1">
                <p className="hidden px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500 lg:block">
                  {group.label}
                </p>
                <div className="flex gap-1 lg:block lg:space-y-1">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        className={({ isActive }) =>
                          `flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition ${
                            isActive ? 'bg-emerald-700 text-white' : 'text-stone-300 hover:bg-stone-800 hover:text-white'
                          }`
                        }
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                        {item.label}
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </aside>
        <div className="min-w-0 p-4 sm:p-6 lg:p-8">
          <Outlet context={{ property, commandCenterEnabled, enabledFeatures } satisfies AdminPropertyContext} />
        </div>
      </div>
    </div>
  );
}

export function useAdminProperty(): AdminPropertyContext {
  return useOutletContext<AdminPropertyContext>();
}
