import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ConvexReactClient } from 'convex/react';
import { ConvexAuthProvider } from '@convex-dev/auth/react';

import './index.css';
import { ProductionAppLayout } from './components/ProductionAppLayout';
import { HomePage } from './pages/HomePage';
import { PropertyPage } from './pages/PropertyPage';
import { UnitTypePage } from './pages/UnitTypePage';
import { ProductionCheckoutPage } from './pages/ProductionCheckoutPage';
import { ProductionConfirmationPage } from './pages/ProductionConfirmationPage';
import { ProductionManageBookingPage } from './pages/ProductionManageBookingPage';
import { AboutPage } from './pages/AboutPage';
import { NotFoundPage } from './pages/NotFoundPage';

const AdminShell = lazy(() => import('./components/AdminShell').then((module) => ({ default: module.AdminShell })));
const AdminCommandPage = lazy(() => import('./pages/AdminCommandPage').then((module) => ({ default: module.AdminCommandPage })));
const AdminFrontDeskPage = lazy(() => import('./pages/AdminFrontDeskPage').then((module) => ({ default: module.AdminFrontDeskPage })));
const AdminHousekeepingPage = lazy(() => import('./pages/AdminHousekeepingPage').then((module) => ({ default: module.AdminHousekeepingPage })));
const AdminMaintenancePage = lazy(() => import('./pages/AdminMaintenancePage').then((module) => ({ default: module.AdminMaintenancePage })));
const AdminFoliosPage = lazy(() => import('./pages/AdminFoliosPage').then((module) => ({ default: module.AdminFoliosPage })));
const AdminNightAuditPage = lazy(() => import('./pages/AdminNightAuditPage').then((module) => ({ default: module.AdminNightAuditPage })));
const AdminReportsPage = lazy(() => import('./pages/AdminReportsPage').then((module) => ({ default: module.AdminReportsPage })));
const AdminQuotesPage = lazy(() => import('./pages/AdminQuotesPage').then((module) => ({ default: module.AdminQuotesPage })));
const AdminContractsPage = lazy(() => import('./pages/AdminContractsPage').then((module) => ({ default: module.AdminContractsPage })));
const AdminSettingsPage = lazy(() => import('./pages/AdminSettingsPage').then((module) => ({ default: module.AdminSettingsPage })));
const AdminLoginPage = lazy(() => import('./pages/AdminLoginPage').then((module) => ({ default: module.AdminLoginPage })));

const loading = (label: string) => <p className="p-8">{label}</p>;
const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
if (!convexUrl) console.error('VITE_CONVEX_URL is required for the production profile.');
const convex = new ConvexReactClient(convexUrl ?? '');
const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element #root not found.');

createRoot(rootElement).render(
  <StrictMode>
    <ConvexAuthProvider client={convex}>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          <Route element={<ProductionAppLayout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/p/:propertySlug" element={<PropertyPage />} />
            <Route path="/p/:propertySlug/stay/:unitTypeSlug" element={<UnitTypePage />} />
            <Route path="/checkout/:bookingId" element={<ProductionCheckoutPage />} />
            <Route path="/confirmation/:code" element={<ProductionConfirmationPage />} />
            <Route path="/manage/:code" element={<ProductionManageBookingPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/admin/login" element={<Suspense fallback={<p className="p-8">Loading staff sign-in…</p>}><AdminLoginPage /></Suspense>} />
            <Route path="/admin" element={<Suspense fallback={<p className="p-8">Loading staff console…</p>}><AdminShell /></Suspense>}>
              <Route index element={<Navigate to="/admin/command" replace />} />
              <Route path="command" element={<Suspense fallback={loading('Loading command center…')}><AdminCommandPage /></Suspense>} />
              <Route path="front-desk" element={<Suspense fallback={loading('Loading front desk…')}><AdminFrontDeskPage /></Suspense>} />
              <Route path="housekeeping" element={<Suspense fallback={loading('Loading housekeeping…')}><AdminHousekeepingPage /></Suspense>} />
              <Route path="maintenance" element={<Suspense fallback={loading('Loading maintenance…')}><AdminMaintenancePage /></Suspense>} />
              <Route path="folios" element={<Suspense fallback={loading('Loading folios…')}><AdminFoliosPage /></Suspense>} />
              <Route path="quotes" element={<Suspense fallback={loading('Loading quotes…')}><AdminQuotesPage /></Suspense>} />
              <Route path="contracts" element={<Suspense fallback={loading('Loading contracts…')}><AdminContractsPage /></Suspense>} />
              <Route path="night-audit" element={<Suspense fallback={loading('Loading night audit…')}><AdminNightAuditPage /></Suspense>} />
              <Route path="reports" element={<Suspense fallback={loading('Loading reports…')}><AdminReportsPage /></Suspense>} />
              <Route path="settings" element={<Suspense fallback={loading('Loading settings…')}><AdminSettingsPage /></Suspense>} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ConvexAuthProvider>
  </StrictMode>,
);
