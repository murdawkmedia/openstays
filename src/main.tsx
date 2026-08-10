import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ConvexReactClient } from 'convex/react';
import { ConvexAuthProvider } from '@convex-dev/auth/react';

import './index.css';
import { AppLayout } from './components/AppLayout';
import { HomePage } from './pages/HomePage';
import { PropertyPage } from './pages/PropertyPage';
import { UnitTypePage } from './pages/UnitTypePage';
import { CheckoutPage } from './pages/CheckoutPage';
import { ConfirmationPage } from './pages/ConfirmationPage';
import { ManageBookingPage } from './pages/ManageBookingPage';
import { AboutPage } from './pages/AboutPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PublicShowcasePage } from './pages/PublicShowcasePage';
import { PublicShowcaseBoundaryPage } from './pages/PublicShowcaseBoundaryPage';
import { PublicOperationsTourPage } from './pages/PublicOperationsTourPage';
import { PUBLIC_SHOWCASE } from './lib/publicShowcase';

const IS_PUBLIC_SHOWCASE_BUILD = import.meta.env.VITE_PUBLIC_SHOWCASE === 'true';
const INCLUDE_PUBLIC_STAFF = !IS_PUBLIC_SHOWCASE_BUILD
  || import.meta.env.VITE_PUBLIC_STAFF === 'true';
const INCLUDE_WAVELENGTH_WALLET = !IS_PUBLIC_SHOWCASE_BUILD
  || import.meta.env.VITE_PUBLIC_WAVELENGTH === 'true';
const WavelengthWalletPage =
  INCLUDE_WAVELENGTH_WALLET ? lazy(() => import('./pages/WavelengthWalletPage')) : null;
const ConsensusRewardPage =
  INCLUDE_WAVELENGTH_WALLET ? lazy(() => import('./pages/ConsensusRewardPage')) : null;
const AdminShell =
  INCLUDE_PUBLIC_STAFF ? lazy(() => import('./components/AdminShell').then((module) => ({ default: module.AdminShell }))) : null;
const AdminCommandPage =
  INCLUDE_PUBLIC_STAFF ? lazy(() => import('./pages/AdminCommandPage').then((module) => ({ default: module.AdminCommandPage }))) : null;
const AdminFrontDeskPage =
  INCLUDE_PUBLIC_STAFF ? lazy(() => import('./pages/AdminFrontDeskPage').then((module) => ({ default: module.AdminFrontDeskPage }))) : null;
const AdminHousekeepingPage =
  INCLUDE_PUBLIC_STAFF ? lazy(() => import('./pages/AdminHousekeepingPage').then((module) => ({ default: module.AdminHousekeepingPage }))) : null;
const AdminMaintenancePage =
  INCLUDE_PUBLIC_STAFF ? lazy(() => import('./pages/AdminMaintenancePage').then((module) => ({ default: module.AdminMaintenancePage }))) : null;
const AdminFoliosPage =
  INCLUDE_PUBLIC_STAFF ? lazy(() => import('./pages/AdminFoliosPage').then((module) => ({ default: module.AdminFoliosPage }))) : null;
const AdminNightAuditPage =
  INCLUDE_PUBLIC_STAFF ? lazy(() => import('./pages/AdminNightAuditPage').then((module) => ({ default: module.AdminNightAuditPage }))) : null;
const AdminReportsPage =
  INCLUDE_PUBLIC_STAFF ? lazy(() => import('./pages/AdminReportsPage').then((module) => ({ default: module.AdminReportsPage }))) : null;
const AdminQuotesPage =
  INCLUDE_PUBLIC_STAFF ? lazy(() => import('./pages/AdminQuotesPage').then((module) => ({ default: module.AdminQuotesPage }))) : null;
const AdminContractsPage =
  INCLUDE_PUBLIC_STAFF ? lazy(() => import('./pages/AdminContractsPage').then((module) => ({ default: module.AdminContractsPage }))) : null;
const AdminWorkflowPage =
  INCLUDE_PUBLIC_STAFF ? lazy(() => import('./pages/AdminWorkflowPage').then((module) => ({ default: module.AdminWorkflowPage }))) : null;
const AdminOperationsPage =
  INCLUDE_PUBLIC_STAFF ? lazy(() => import('./pages/AdminOperationsPage').then((module) => ({ default: module.AdminOperationsPage }))) : null;
const AdminSettingsPage =
  INCLUDE_PUBLIC_STAFF ? lazy(() => import('./pages/AdminSettingsPage').then((module) => ({ default: module.AdminSettingsPage }))) : null;
const AdminLoginPage =
  INCLUDE_PUBLIC_STAFF ? lazy(() => import('./pages/AdminLoginPage').then((module) => ({ default: module.AdminLoginPage }))) : null;

const walletPaymentElement = PUBLIC_SHOWCASE.allowLiveWavelength && WavelengthWalletPage ? (
  <Suspense fallback={<p className="p-8">Loading signet wallet…</p>}>
    <WavelengthWalletPage />
  </Suspense>
) : <PublicShowcaseBoundaryPage />;
const rewardWalletElement = PUBLIC_SHOWCASE.allowLiveWavelength && ConsensusRewardPage ? (
  <Suspense fallback={<p className="p-8">Loading reward wallet…</p>}>
    <ConsensusRewardPage />
  </Suspense>
) : <PublicShowcaseBoundaryPage />;
const staffShellElement = PUBLIC_SHOWCASE.allowStaffRoutes && AdminShell ? (
  <Suspense fallback={<p className="p-8">Loading staff console…</p>}><AdminShell /></Suspense>
) : <PublicShowcaseBoundaryPage />;
const staffCommandElement = PUBLIC_SHOWCASE.allowStaffRoutes && AdminCommandPage ? (
  <Suspense fallback={<p className="p-8">Loading command center…</p>}><AdminCommandPage /></Suspense>
) : <PublicShowcaseBoundaryPage />;
const staffOperationsElement = PUBLIC_SHOWCASE.allowStaffRoutes && AdminOperationsPage ? (
  <Suspense fallback={<p className="p-8">Loading staff operationsâ€¦</p>}><AdminOperationsPage /></Suspense>
) : <PublicShowcaseBoundaryPage />;
const staffSettingsElement = PUBLIC_SHOWCASE.allowStaffRoutes && AdminSettingsPage ? (
  <Suspense fallback={<p className="p-8">Loading staff settingsâ€¦</p>}><AdminSettingsPage /></Suspense>
) : <PublicShowcaseBoundaryPage />;
const staffLoginElement = PUBLIC_SHOWCASE.allowStaffRoutes && AdminLoginPage ? (
  <Suspense fallback={<p className="p-8">Loading staff sign-inâ€¦</p>}><AdminLoginPage /></Suspense>
) : <PublicShowcaseBoundaryPage />;

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
if (!convexUrl) {
  // eslint-disable-next-line no-console
  console.error(
    'VITE_CONVEX_URL is not set. Run `npx convex dev` (or set the env var) to connect the app to a Convex deployment.',
  );
}
const convex = new ConvexReactClient(convexUrl ?? '');

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root not found.');

createRoot(rootElement).render(
  <StrictMode>
    <ConvexAuthProvider client={convex}>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={PUBLIC_SHOWCASE.enabled ? <PublicShowcasePage /> : <HomePage />} />
            <Route path="/p/:propertySlug" element={<PropertyPage />} />
            <Route path="/p/:propertySlug/stay/:unitTypeSlug" element={<UnitTypePage />} />
            <Route path="/checkout/:bookingId" element={<CheckoutPage />} />
            <Route path="/confirmation/:code" element={<ConfirmationPage />} />
            <Route path="/manage/:code" element={<ManageBookingPage />} />
            <Route path="/wallet/pay/:bookingId" element={walletPaymentElement} />
            <Route path="/wallet/:bookingId" element={walletPaymentElement} />
            <Route path="/wallet/reward/:code" element={rewardWalletElement} />
            <Route path="/tour/operations" element={<PublicOperationsTourPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/admin/login" element={staffLoginElement} />
            <Route path="/admin" element={staffShellElement}>
              <Route index element={<Navigate to="/admin/command" replace />} />
              <Route path="command" element={staffCommandElement} />
              {AdminWorkflowPage ? (
                <>
                  <Route path="front-desk" element={AdminFrontDeskPage ? <Suspense fallback={<p>Loading front desk…</p>}><AdminFrontDeskPage /></Suspense> : <PublicShowcaseBoundaryPage />} />
                  <Route path="housekeeping" element={AdminHousekeepingPage ? <Suspense fallback={<p>Loading housekeeping…</p>}><AdminHousekeepingPage /></Suspense> : <PublicShowcaseBoundaryPage />} />
                  <Route path="maintenance" element={AdminMaintenancePage ? <Suspense fallback={<p>Loading maintenance…</p>}><AdminMaintenancePage /></Suspense> : <PublicShowcaseBoundaryPage />} />
                  <Route path="folios" element={AdminFoliosPage ? <Suspense fallback={<p>Loading folios…</p>}><AdminFoliosPage /></Suspense> : <PublicShowcaseBoundaryPage />} />
                  <Route path="quotes" element={AdminQuotesPage ? <Suspense fallback={<p>Loading quotes…</p>}><AdminQuotesPage /></Suspense> : <PublicShowcaseBoundaryPage />} />
                  <Route path="contracts" element={AdminContractsPage ? <Suspense fallback={<p>Loading contracts…</p>}><AdminContractsPage /></Suspense> : <PublicShowcaseBoundaryPage />} />
                  <Route path="night-audit" element={AdminNightAuditPage ? <Suspense fallback={<p>Loading night audit…</p>}><AdminNightAuditPage /></Suspense> : <PublicShowcaseBoundaryPage />} />
                  <Route path="reports" element={AdminReportsPage ? <Suspense fallback={<p>Loading reports…</p>}><AdminReportsPage /></Suspense> : <PublicShowcaseBoundaryPage />} />
                </>
              ) : null}
              <Route path="operations" element={staffOperationsElement} />
              <Route path="settings" element={staffSettingsElement} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ConvexAuthProvider>
  </StrictMode>,
);
